import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import * as auth from "./routes/auth";
import * as backend from "./routes/backend";
import * as video from "./routes/video";
import * as stream from "./routes/stream";
import * as thumbnail from "./routes/thumbnail";
import { AppError, errorResponse } from "@/lib/errors";
import { withServerCors } from "@/lib/server-cors";
import { logEvent, setLogContext } from "@/lib/logging";

const requestContext = new AsyncLocalStorage<{ requestId: string }>();
setLogContext(() => requestContext.getStore() || {});

export type Handler = (request: Request) => Response | Promise<Response>;
export const routes: Record<string, Record<string, Handler>> = {
  "/api/auth": { GET: auth.GET, POST: auth.POST, DELETE: auth.DELETE, OPTIONS: auth.OPTIONS },
  "/api/backend": { GET: backend.GET, OPTIONS: backend.OPTIONS },
  "/api/video": { POST: video.POST, OPTIONS: video.OPTIONS },
  "/api/stream": { GET: stream.GET, HEAD: stream.HEAD, OPTIONS: stream.OPTIONS },
  "/api/thumbnail": { GET: thumbnail.GET, OPTIONS: thumbnail.OPTIONS },
};

export async function dispatch(request: Request, table = routes): Promise<Response> {
  const path = new URL(request.url).pathname;
  const route = Object.hasOwn(table, path) ? table[path] : undefined;
  const handler = route && Object.hasOwn(route, request.method) ? route[request.method] : undefined;
  if (handler) return handler(request);
  return withServerCors(request, async () => {
    const response = errorResponse(new AppError(route ? "METHOD_NOT_ALLOWED" : "NOT_FOUND", route ? "Method không được hỗ trợ." : "Không có API này.", route ? 405 : 404));
    if (route) response.headers.set("Allow", Object.keys(route).join(", "));
    return response;
  });
}

function headersFromNode(incoming: IncomingMessage): Headers {
  const headers = new Headers();
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
    headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
  }
  // Do not trust client/proxy headers as a rate-limit identity. The existing
  // limiter uses the authenticated session; login falls back to one shared bucket.
  headers.delete("x-forwarded-for");
  headers.delete("cf-connecting-ip");
  return headers;
}

export function createApiServer(handler: Handler = dispatch) {
  const server = createServer(async (incoming, outgoing) => {
    const requestId = randomUUID();
    const started = performance.now();
    const controller = new AbortController();
    const method = incoming.method || "GET";
    let path = "unknown";
    let status = 500;
    let code: string | undefined;
    let complete = false;
    const timeout = setTimeout(() => controller.abort(), 120_000);
    timeout.unref();
    incoming.once("aborted", () => controller.abort());
    outgoing.once("close", () => { if (!outgoing.writableFinished) controller.abort(); });
    try {
      // Use a fixed internal origin, never a user-controlled Host/forwarded host.
      const target = incoming.url || "/";
      if (!target.startsWith("/") || target.startsWith("//")) throw new AppError("INVALID_REQUEST", "Đường dẫn không hợp lệ.", 400);
      const url = new URL(`http://localhost${target}`);
      path = Object.hasOwn(routes, url.pathname) ? url.pathname : "unknown";
      logEvent("request.start", { requestId, method, path });
      const headers = headersFromNode(incoming);
      const hasBody = method !== "GET" && method !== "HEAD";
      const init: RequestInit & { duplex?: "half" } = {
        method, headers, signal: controller.signal,
        ...(hasBody ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" as const } : {}),
      };
      const request = new Request(url, init);
      const response = await requestContext.run({ requestId }, () => handler(request));
      status = response.status;
      code = response.headers.get("x-relay-error") || undefined;
      outgoing.statusCode = status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      outgoing.setHeader("X-Request-Id", requestId);
      outgoing.setHeader("X-Content-Type-Options", "nosniff");
      outgoing.setHeader("X-Frame-Options", "DENY");
      outgoing.setHeader("Referrer-Policy", "no-referrer");
      if (method === "HEAD" || !response.body) {
        await response.body?.cancel();
        outgoing.end();
      } else {
        await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), outgoing, { signal: controller.signal });
      }
      complete = true;
    } catch (error) {
      code = controller.signal.aborted ? "REQUEST_ABORTED" : error instanceof AppError ? error.code : "TRANSPORT_ERROR";
      if (!outgoing.headersSent && !outgoing.destroyed) {
        const response = errorResponse(error);
        status = response.status;
        outgoing.statusCode = status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        outgoing.setHeader("X-Request-Id", requestId);
        outgoing.end(await response.text());
      } else if (!outgoing.destroyed) outgoing.destroy();
    } finally {
      clearTimeout(timeout);
      controller.abort();
      // No query, body, Authorization, cookies, tickets or upstream URLs in logs.
      logEvent("request.end", { requestId, method, path, status, code, complete, durationMs: Math.round(performance.now() - started) });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
