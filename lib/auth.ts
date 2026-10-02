import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";

export const COOKIE_NAME = "relay_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export type Session = { sid: string; exp: number };
export type TokenScope = "session" | "media";

export function isConfigured() {
  return (process.env.ACCESS_PASSWORD?.length ?? 0) > 0 && (process.env.AUTH_SECRET?.length ?? 0) >= 32;
}

export function requireConfiguration() {
  if (!isConfigured()) {
    throw new AppError("NOT_CONFIGURED", "ACCESS_PASSWORD không được để trống; AUTH_SECRET cần ít nhất 32 ký tự trên server.", 503);
  }
}

function key(scope: TokenScope): Buffer {
  requireConfiguration();
  // Domain-separated keys prevent a media capability from being used as a session.
  return createHash("sha256").update(`relay:v1:${scope}:${process.env.AUTH_SECRET}:${process.env.ACCESS_PASSWORD}`).digest();
}

export function sealToken(scope: TokenScope, value: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(scope), iv);
  cipher.setAAD(Buffer.from(`relay:v1:${scope}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function openToken(scope: TokenScope, token: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length > 16384 || token.length < 40) {
    throw new AppError("INVALID_TOKEN", "Phiên hoặc luồng không hợp lệ.", 401);
  }
  try {
    const data = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(scope), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(`relay:v1:${scope}`));
    decipher.setAuthTag(data.subarray(12, 28));
    const clear = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
    return JSON.parse(clear.toString("utf8"));
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_CONFIGURED") throw error;
    throw new AppError("INVALID_TOKEN", "Phiên hoặc luồng không hợp lệ.", 401);
  }
}

export function checkPassword(value: unknown) {
  requireConfiguration();
  if (typeof value !== "string" || value.length > 512) return false;
  const actual = createHash("sha256").update(value).digest();
  const expected = createHash("sha256").update(process.env.ACCESS_PASSWORD!).digest();
  return timingSafeEqual(actual, expected);
}

export function createSession(now = Date.now()): Session {
  return { sid: randomBytes(24).toString("base64url"), exp: Math.floor(now / 1000) + SESSION_SECONDS };
}

export function parseSession(token: string | undefined, now = Date.now()): Session | null {
  if (!token || !isConfigured()) return null;
  try {
    const data = openToken("session", token) as Partial<Session> | null;
    if (!data || typeof data.sid !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(data.sid) || !Number.isSafeInteger(data.exp)) return null;
    const exp = data.exp as number;
    if (exp <= Math.floor(now / 1000) || exp > Math.floor(now / 1000) + SESSION_SECONDS + 60) return null;
    return { sid: data.sid, exp };
  } catch {
    return null;
  }
}

export function sessionFromRequest(request: Request): Session | null {
  const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return parseSession(raw?.slice(COOKIE_NAME.length + 1));
}

export function bearerSessionFromRequest(request: Request): Session | null {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,16384})$/)?.[1];
  // Worker endpoints never fall back to cookies or URL parameters.
  return parseSession(token);
}

export function requireBearerSession(request: Request): Session {
  requireConfiguration();
  const session = bearerSessionFromRequest(request);
  if (!session) throw new AppError("AUTH_REQUIRED", "Phiên đã hết hạn. Hãy mở khóa lại.", 401);
  return session;
}

export function requireSession(request: Request): Session {
  requireConfiguration();
  const session = sessionFromRequest(request);
  if (!session) throw new AppError("AUTH_REQUIRED", "Phiên đã hết hạn. Hãy mở khóa lại.", 401);
  return session;
}

export function sessionCookie(value: string, maxAge = SESSION_SECONDS) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
