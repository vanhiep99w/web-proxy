import { apiSession, relayMode } from "@/lib/relay-mode";
import { forwardHome } from "@/lib/home-proxy";
import { AppError, errorResponse } from "@/lib/errors";
import { boundedMediaBody } from "@/lib/media";
import { consumeRateLimit } from "@/lib/rate-limit";
import { serverPreflight, withServerCors } from "@/lib/server-cors";
import { VIDEO_ID } from "@/lib/video-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

async function getThumbnail(request: Request) {
  try {
    const session = apiSession(request);
    consumeRateLimit(`thumb:${session.sid}`, 90, 60_000);
    if (relayMode() === "frontend") return await forwardHome(request, "thumbnail", session);
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !VIDEO_ID.test(id)) throw new AppError("INVALID_VIDEO_URL", "Mã video không hợp lệ.");
    // A fixed origin and a validated ID; no user-supplied image URL is fetched.
    const response = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, {
      // Workers supports manual/follow, not redirect:error. Reject 3xx below.
      cache: "no-store", redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
    });
    if (!response.ok || !response.body) throw new AppError("THUMBNAIL_UNAVAILABLE", "Không lấy được ảnh video.", 502);
    const size = Number(response.headers.get("content-length"));
    const type = response.headers.get("content-type");
    if (!Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024 || type !== "image/jpeg") {
      await response.body.cancel();
      throw new AppError("THUMBNAIL_UNAVAILABLE", "Ảnh video không hợp lệ.", 502);
    }
    return new Response(boundedMediaBody(response.body, size), {
      headers: {
        "Content-Type": "image/jpeg", "Content-Length": String(size),
        "Cache-Control": "private, max-age=300", "Vary": "Cookie",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) { return errorResponse(error); }
}

export const GET = (request: Request) => withServerCors(request, () => getThumbnail(request));
export const OPTIONS = (request: Request) => serverPreflight(request, ["GET"]);
