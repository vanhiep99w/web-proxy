import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";

// Best-effort per-process protection, NOT a distributed rate limiter.
// Keep the Node API bound to loopback behind the documented Caddy reverse proxy.
const buckets = new Map<string, { count: number; reset: number }>();

export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  for (const [id, bucket] of buckets) {
    if (bucket.reset <= now) buckets.delete(id);
  }
  if (buckets.size >= 2048 && !buckets.has(key)) {
    throw new AppError("RATE_LIMITED", "Có quá nhiều yêu cầu. Hãy thử lại sau một phút.", 429);
  }
  const bucket = buckets.get(key) ?? { count: 0, reset: now + windowMs };
  if (++bucket.count > limit) {
    throw new AppError("RATE_LIMITED", "Có quá nhiều yêu cầu. Hãy thử lại sau một phút.", 429);
  }
  buckets.set(key, bucket);
}

export function loginBucket(request: Request) {
  // Cloud platforms own their forwarding headers. In server mode the app binds
  // to loopback, so only the local Caddy proxy can supply X-Forwarded-For.
  const mode = process.env.RELAY_MODE;
  const ip = mode === "worker" ? request.headers.get("cf-connecting-ip") :
    mode === "server" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() :
    process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : "local";
  return `login:${createHash("sha256").update(ip || "unknown").digest("hex")}`;
}
