import { normalizeApiOrigin } from "@/lib/api-origin";
import { AppError } from "@/lib/errors";

export function frontendOrigins(value = process.env.FRONTEND_ORIGINS): string[] {
  try {
    const values = value?.split(",").map((entry) => entry.trim()) || [];
    if (!values.length || values.length > 16 || values.some((entry) => !entry)) throw new Error("Missing origins");
    return [...new Set(values.map(normalizeApiOrigin))];
  } catch {
    throw new AppError("WORKER_NOT_CONFIGURED", "FRONTEND_ORIGINS cần chứa origin HTTPS chính xác của frontend, ngăn cách bằng dấu phẩy; không dùng wildcard.", 503);
  }
}

export function assertWorkerOrigin(request: Request): string {
  const origin = request.headers.get("origin");
  if (!origin || !frontendOrigins().includes(origin)) {
    throw new AppError("ORIGIN_DENIED", "Website này không được phép gọi backend Cloudflare.", 403);
  }
  return origin;
}

export function workerCors(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers);
  const vary = new Set((headers.get("vary") || "").split(",").map((entry) => entry.trim()).filter(Boolean));
  vary.add("Origin"); vary.add("Authorization");
  headers.set("Vary", [...vary].join(", "));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, X-Relay-Error");
  }
  // Bearer authentication deliberately does not use cross-site cookies.
  headers.delete("Set-Cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
