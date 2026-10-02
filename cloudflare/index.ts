import * as auth from "@/app/api/auth/route";
import * as video from "@/app/api/video/route";
import * as stream from "@/app/api/stream/route";
import * as thumbnail from "@/app/api/thumbnail/route";
import * as backend from "@/app/api/backend/route";
import { AppError, errorResponse } from "@/lib/errors";
import { relayMode } from "@/lib/relay-mode";
import { loginBucket } from "@/lib/rate-limit";
import { assertWorkerOrigin, workerCors } from "@/lib/worker-cors";

export interface WorkerEnv {
  LOGIN_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

type Handler = (request: Request) => Promise<Response>;
const routes: Record<string, Record<string, Handler>> = {
  "/api/auth": { GET: auth.GET, POST: auth.POST, DELETE: auth.DELETE },
  "/api/video": { POST: video.POST },
  "/api/stream": { GET: stream.GET, HEAD: stream.HEAD },
  "/api/thumbnail": { GET: thumbnail.GET },
  "/api/backend": { GET: backend.GET },
};
const allowedHeaders = new Set(["authorization", "content-type", "range"]);

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    let origin: string | undefined;
    try {
      if (relayMode() !== "worker") throw new AppError("WORKER_WRONG_MODE", "Cloudflare backend cần RELAY_MODE=worker.", 503);
      origin = assertWorkerOrigin(request);
      const path = new URL(request.url).pathname;
      const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
      if (!route) throw new AppError("NOT_FOUND", "Không có API này.", 404);
      if (request.method === "OPTIONS") {
        const method = request.headers.get("access-control-request-method") || "";
        const rawHeaders = request.headers.get("access-control-request-headers") || "";
        const requestedHeaders = rawHeaders.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
        if (!Object.hasOwn(route, method) || rawHeaders.length > 1024 || requestedHeaders.some((value) => !allowedHeaders.has(value))) {
          throw new AppError("PREFLIGHT_DENIED", "Method hoặc header không được phép.", 403);
        }
        return workerCors(new Response(null, { status: 204, headers: {
          "Access-Control-Allow-Methods": Object.keys(route).join(", "),
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
          "Access-Control-Max-Age": "600",
          "Cache-Control": "private, no-store",
        } }), origin);
      }
      const handler = Object.hasOwn(route, request.method) ? route[request.method] : undefined;
      if (!handler) {
        const response = errorResponse(new AppError("METHOD_NOT_ALLOWED", "Method không được hỗ trợ.", 405));
        response.headers.set("Allow", [...Object.keys(route), "OPTIONS"].join(", "));
        return workerCors(response, origin);
      }
      if (new URL(request.url).pathname === "/api/auth" && request.method === "POST") {
        if (!env.LOGIN_RATE_LIMITER) throw new AppError("WORKER_NOT_CONFIGURED", "Thiếu binding LOGIN_RATE_LIMITER.", 503);
        const { success } = await env.LOGIN_RATE_LIMITER.limit({ key: loginBucket(request) });
        if (!success) throw new AppError("RATE_LIMITED", "Có quá nhiều yêu cầu. Hãy thử lại sau một phút.", 429);
      }
      const response = await handler(request);
      return workerCors(response, origin);
    } catch (error) {
      const response = errorResponse(error);
      const result = workerCors(response, origin);
      return request.method === "HEAD" ? new Response(null, { status: result.status, headers: result.headers }) : result;
    }
  },
};
export default worker;
