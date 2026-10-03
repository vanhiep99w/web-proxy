import { createHash, timingSafeEqual } from "node:crypto";
import { requireBearerSession, requireConfiguration, requireSession, SESSION_SECONDS, type Session } from "@/lib/auth";
import { normalizeApiOrigin } from "@/lib/api-origin";
import { assertDirectOrigin } from "@/lib/worker-cors";
import { AppError } from "@/lib/errors";

export type RelayMode = "standalone" | "frontend" | "home" | "cloudflare" | "worker" | "vps" | "server";

export function relayMode(): RelayMode {
  const mode = process.env.RELAY_MODE || "standalone";
  if (!["standalone", "frontend", "home", "cloudflare", "worker", "vps", "server"].includes(mode)) {
    throw new AppError("INVALID_RELAY_MODE", "RELAY_MODE phải là standalone, frontend, home, cloudflare, worker, vps hoặc server.", 503);
  }
  return mode as RelayMode;
}

export function isDirectFrontendMode(mode = relayMode()) {
  return mode === "cloudflare" || mode === "vps";
}

export function isDirectBackendMode(mode = relayMode()) {
  return mode === "worker" || mode === "server";
}

export function requireBrowserMode() {
  const mode = relayMode();
  if (isDirectFrontendMode(mode)) {
    throw new AppError("EXTERNAL_BACKEND", "Frontend này gọi API trực tiếp trên backend riêng; API Vercel đã tắt.", 404);
  }
  if (mode === "home") {
    throw new AppError("HOME_ONLY", "Backend tại nhà chỉ nhận request có khóa riêng từ Vercel.", 404);
  }
}

export function serverApiOrigin(): string {
  if (relayMode() !== "server") throw new AppError("SERVER_WRONG_MODE", "Node backend cần RELAY_MODE=server.", 503);
  try {
    return normalizeApiOrigin(process.env.API_ORIGIN || "");
  } catch {
    throw new AppError("SERVER_NOT_CONFIGURED", "API_ORIGIN cần là origin HTTPS công khai của Oracle VPS, không kèm đường dẫn.", 503);
  }
}

export function homeKey(): string {
  const key = process.env.HOME_BACKEND_KEY;
  if (!key || key.length < 32 || key.length > 512 || /[\r\n]/.test(key)) {
    throw new AppError("HOME_NOT_CONFIGURED", "HOME_BACKEND_KEY cần ít nhất 32 ký tự, giống nhau ở Vercel và máy nhà.", 503);
  }
  return key;
}

export function requireHomeKey(request: Request) {
  if (relayMode() !== "home") throw new AppError("HOME_WRONG_MODE", "Máy backend cần chạy với RELAY_MODE=home.", 404);
  const expected = homeKey();
  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || supplied.length > 512 || !timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(expected).digest(),
  )) {
    throw new AppError("HOME_KEY_DENIED", "Khóa kết nối backend không hợp lệ.", 403);
  }
  requireConfiguration();
}

export function apiSession(request: Request, now = Date.now()): Session {
  const mode = relayMode();
  if (isDirectBackendMode(mode)) {
    assertDirectOrigin(request);
    if (mode === "server") serverApiOrigin();
    return requireBearerSession(request);
  }
  if (mode !== "home") {
    requireBrowserMode();
    return requireSession(request);
  }
  requireHomeKey(request);
  // Only the authenticated frontend may supply a session context. Browser cookies
  // and a user-supplied Authorization header cannot bypass frontend login.
  const sid = request.headers.get("x-relay-session-id");
  const rawExpiry = request.headers.get("x-relay-session-expires");
  const exp = Number(rawExpiry);
  const seconds = Math.floor(now / 1000);
  if (!sid || !/^[A-Za-z0-9_-]{32}$/.test(sid) || !rawExpiry || !/^\d+$/.test(rawExpiry) ||
      !Number.isSafeInteger(exp) || exp <= seconds || exp > seconds + SESSION_SECONDS + 60) {
    throw new AppError("HOME_SESSION_INVALID", "Phiên chuyển tiếp không hợp lệ hoặc đồng hồ máy backend lệch giờ.", 403);
  }
  return { sid, exp };
}

export function playbackOrigin(request: Request): string {
  const mode = relayMode();
  if (mode === "worker") return new URL(request.url).origin;
  if (mode === "server") return serverApiOrigin();
  const value = mode === "home" ? request.headers.get("x-relay-frontend-origin") : request.headers.get("origin");
  try {
    const url = new URL(value || "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.origin !== value || url.username || url.password ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("Invalid origin");
    return url.origin;
  } catch {
    throw new AppError("INVALID_FRONTEND_ORIGIN", "Origin của giao diện không hợp lệ.", 400);
  }
}
