import { AppError, errorResponse } from "@/lib/errors";
import { relayMode, serverApiOrigin } from "@/lib/relay-mode";
import { assertDirectOrigin, directCors } from "@/lib/worker-cors";

const ALLOWED_HEADERS = new Set(["authorization", "content-type", "range"]);

// Next.js route handlers do not add CORS automatically. Cloudflare has its own
// entrypoint wrapper; this wrapper is only active for the self-hosted Node API.
export async function withServerCors(request: Request, handler: () => Promise<Response>): Promise<Response> {
  let mode;
  try { mode = relayMode(); } catch { return handler(); }
  if (mode !== "server") return handler();
  let origin: string | undefined;
  try {
    serverApiOrigin();
    origin = assertDirectOrigin(request);
    return directCors(await handler(), origin);
  } catch (error) {
    const response = directCors(errorResponse(error), origin);
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
}

export function serverPreflight(request: Request, methods: readonly string[]): Response {
  let origin: string | undefined;
  try {
    if (relayMode() !== "server") throw new AppError("NOT_FOUND", "Không có API này.", 404);
    serverApiOrigin();
    origin = assertDirectOrigin(request);
    const method = (request.headers.get("access-control-request-method") || "").toUpperCase();
    const rawHeaders = request.headers.get("access-control-request-headers") || "";
    const requestedHeaders = rawHeaders.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!methods.includes(method) || rawHeaders.length > 1024 || requestedHeaders.some((value) => !ALLOWED_HEADERS.has(value))) {
      throw new AppError("PREFLIGHT_DENIED", "Method hoặc header không được phép.", 403);
    }
    return directCors(new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Methods": methods.join(", "),
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
      "Access-Control-Max-Age": "600",
      "Cache-Control": "private, no-store",
    } }), origin);
  } catch (error) {
    return directCors(errorResponse(error), origin);
  }
}
