import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";

// Best-effort per-instance protection, NOT a distributed serverless rate limiter.
// Configure Vercel Firewall rules as documented in README.md for public deployment.
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
  // Only platform-owned headers are trusted; never an arbitrary X-Forwarded-For.
  const ip = process.env.RELAY_MODE === "worker" ? request.headers.get("cf-connecting-ip") :
    process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : "local";
  return `login:${createHash("sha256").update(ip || "unknown").digest("hex")}`;
}
