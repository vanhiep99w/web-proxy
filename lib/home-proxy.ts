import type { Session } from "@/lib/auth";
import { AppError, privateJson } from "@/lib/errors";
import { readJson } from "@/lib/http";
import { boundedMediaBody } from "@/lib/media";
import { MAX_SEGMENT_BYTES, parseRange } from "@/lib/range";
import { homeKey } from "@/lib/relay-mode";
import { VIDEO_ID } from "@/lib/video-id";

type Resource = "video" | "stream" | "thumbnail" | "backend";
const TOKEN = /^[A-Za-z0-9_-]{40,16384}$/;
const MEDIA_TYPE = /^(audio|video)\/mp4(?:; codecs="[A-Za-z0-9., -]+")?$/;

export function homeBackendUrl(): URL {
  try {
    const url = new URL(process.env.HOME_BACKEND_URL || "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && !process.env.VERCEL))) throw new Error("Invalid URL");
    return url;
  } catch {
    throw new AppError("HOME_URL_INVALID", "HOME_BACKEND_URL phải là URL HTTPS của máy nhà, không kèm đường dẫn. Local có thể dùng http://127.0.0.1:3001.", 503);
  }
}

async function badResponse(response: Response): Promise<never> {
  if (!response.bodyUsed) await response.body?.cancel();
  throw new AppError("HOME_BAD_RESPONSE", "Backend trả về dữ liệu không đúng. Kiểm tra URL, RELAY_MODE=home và phiên bản code ở máy nhà.", 502);
}

function validManifest(value: string, origin: string) {
  const urls = [...value.matchAll(/<BaseURL>(.*?)<\/BaseURL>/g)];
  if (!urls.length || urls.length > 32) return false;
  return urls.every((match) => {
    try {
      const url = new URL(match[1].replaceAll("&amp;", "&"));
      return url.origin === origin && url.pathname === "/api/stream" && TOKEN.test(url.searchParams.get("ticket") || "");
    } catch { return false; }
  });
}

// The cloud only contacts this one operator-configured backend. There is no
// arbitrary proxy URL, direct Google fallback, or forwarding of browser cookies.
export async function forwardHome(request: Request, resource: Resource, session: Session, body?: Record<string, unknown>): Promise<Response> {
  const url = new URL(`/api/${resource}`, homeBackendUrl());
  const incoming = new URL(request.url);
  if (resource === "stream") {
    const ticket = incoming.searchParams.get("ticket") || "";
    if (!TOKEN.test(ticket)) throw new AppError("INVALID_TOKEN", "Thiếu hoặc sai quyền truy cập luồng.", 403);
    url.searchParams.set("ticket", ticket);
  }
  if (resource === "thumbnail") {
    const id = incoming.searchParams.get("id") || "";
    if (!VIDEO_ID.test(id)) throw new AppError("INVALID_VIDEO_URL", "Mã video không hợp lệ.");
    url.searchParams.set("id", id);
  }
  const headers = new Headers({
    Authorization: `Bearer ${homeKey()}`,
    "X-Relay-Session-Id": session.sid,
    "X-Relay-Session-Expires": String(session.exp),
  });
  if (resource === "video") {
    headers.set("Content-Type", "application/json");
    headers.set("X-Relay-Frontend-Origin", request.headers.get("origin") || "");
  }
  const range = request.headers.get("range");
  if (resource === "stream" && range) {
    if (range.length > 128) throw new AppError("INVALID_RANGE", "Byte range không hợp lệ.", 416);
    headers.set("Range", range);
  }
  const method = resource === "video" ? "POST" : request.method === "HEAD" ? "HEAD" : "GET";
  const timeout = resource === "video" ? 105000 : resource === "stream" ? 45000 : 12000;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
  let response: Response;
  try {
    response = await fetch(url, {
      method, headers, body: resource === "video" ? JSON.stringify(body) : undefined,
      signal, redirect: "manual", cache: "no-store",
    });
  } catch {
    throw new AppError("HOME_UNREACHABLE", "Không kết nối được backend tại nhà. Kiểm tra máy đang bật, server/tunnel đang chạy và URL HTTPS còn hoạt động.", 502);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new AppError("HOME_REDIRECT_DENIED", "Backend đang chuyển hướng. Dùng URL HTTPS trực tiếp, không dùng trang đăng nhập của dịch vụ tunnel.", 502);
  }
  if (method === "HEAD" && !response.ok) {
    const code = response.headers.get("x-relay-error") || "HOME_BAD_RESPONSE";
    const status = ["HOME_KEY_DENIED", "AUTH_REQUIRED", "HOME_WRONG_MODE"].includes(code) ? 502 : response.status;
    return new Response(null, { status, headers: { "Cache-Control": "private, no-store", "X-Relay-Error": code } });
  }
  const json = response.headers.get("content-type")?.startsWith("application/json");
  if (json) {
    let data: Record<string, unknown>;
    try { data = await readJson(response, 256 * 1024); }
    catch { return badResponse(response); }
    if (!response.ok) {
      const error = data.error as { code?: unknown; message?: unknown } | undefined;
      if (typeof error?.code !== "string" || !/^[A-Z0-9_]{1,64}$/.test(error.code) || typeof error.message !== "string") return badResponse(response);
      if (["HOME_KEY_DENIED", "HOME_WRONG_MODE", "AUTH_REQUIRED", "ORIGIN_DENIED"].includes(error.code)) {
        throw new AppError("HOME_CONFIGURATION_ERROR", "Kiểm tra HOME_BACKEND_KEY giống nhau ở hai bên và máy nhà chạy RELAY_MODE=home.", 502);
      }
      throw new AppError(error.code.slice(0, 64), error.message.slice(0, 1000), response.status);
    }
    if (resource === "video") {
      const origin = request.headers.get("origin") || "";
      if (data.id !== body?.url || data.mode !== body?.mode || typeof data.title !== "string" || data.title.length > 1000 ||
          typeof data.author !== "string" || data.author.length > 500 || typeof data.duration !== "number" ||
          !Number.isFinite(data.duration) || data.duration < 0 || typeof data.quality !== "string" || data.quality.length > 80 ||
          data.thumbnail !== `/api/thumbnail?id=${data.id}` || !Number.isSafeInteger(data.expiresAt) ||
          (data.expiresAt as number) > session.exp || (data.expiresAt as number) <= Math.floor(Date.now() / 1000) ||
          typeof data.manifest !== "string" || !validManifest(data.manifest, origin)) return badResponse(response);
    } else if (resource !== "backend" || data.mode !== "home" || data.connected !== true) {
      return badResponse(response);
    }
    const publicData = resource === "video" ? Object.fromEntries(
      ["id", "title", "author", "duration", "thumbnail", "manifest", "mode", "quality", "expiresAt"].map((key) => [key, data[key]]),
    ) : { connected: true, mode: "home", serverTime: typeof data.serverTime === "string" ? data.serverTime.slice(0, 64) : undefined };
    const result = privateJson(publicData);
    result.headers.set("X-Relay-Backend", "home");
    return result;
  }
  if (!response.ok || (resource !== "stream" && resource !== "thumbnail")) return badResponse(response);
  const size = Number(response.headers.get("content-length"));
  const type = response.headers.get("content-type") || "";
  if (!Number.isSafeInteger(size) || size <= 0) return badResponse(response);
  const resultHeaders = new Headers({
    "Content-Type": type, "Content-Length": String(size),
    "Cache-Control": resource === "thumbnail" ? "private, max-age=300" : "private, no-store",
    "Vary": "Cookie, Range", "Cross-Origin-Resource-Policy": "same-origin", "X-Relay-Backend": "home",
  });
  if (resource === "thumbnail") {
    if (response.status !== 200 || type !== "image/jpeg" || size > 1024 * 1024) return badResponse(response);
  } else {
    if (!MEDIA_TYPE.test(type)) return badResponse(response);
    resultHeaders.set("Accept-Ranges", "bytes");
    if (method === "HEAD" && !range) {
      if (response.status !== 200) return badResponse(response);
      return new Response(null, { headers: resultHeaders });
    }
    const raw = response.headers.get("content-range") || "";
    const match = raw.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match || response.status !== 206 || size > MAX_SEGMENT_BYTES) return badResponse(response);
    const total = Number(match[3]);
    let wanted;
    try { wanted = parseRange(range, total); } catch { return badResponse(response); }
    if (wanted.start !== Number(match[1]) || wanted.end !== Number(match[2]) || wanted.length !== size) return badResponse(response);
    resultHeaders.set("Content-Range", raw);
  }
  if (method === "HEAD") return new Response(null, { status: response.status, headers: resultHeaders });
  if (!response.body) return badResponse(response);
  return new Response(boundedMediaBody(response.body, size), { status: response.status, headers: resultHeaders });
}
