import { apiSession, playbackOrigin, relayMode } from "@/lib/relay-mode";
import { forwardHome } from "@/lib/home-proxy";
import { AppError, errorResponse, privateJson } from "@/lib/errors";
import { assertSameOrigin, readJson } from "@/lib/http";
import { assertWorkerOrigin } from "@/lib/worker-cors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { parseVideoId } from "@/lib/video-id";
import { resolveVideo } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    if (relayMode() === "worker") assertWorkerOrigin(request);
    else if (relayMode() !== "home") assertSameOrigin(request);
    const session = apiSession(request);
    consumeRateLimit(`video:${session.sid}`, 15, 60_000);
    const body = await readJson(request);
    const id = parseVideoId(body.url);
    const mode = body.mode ?? "video";
    const quality = body.quality ?? 360;
    if (mode !== "video" && mode !== "audio") throw new AppError("INVALID_MODE", "Chế độ phát không hợp lệ.");
    if (quality !== 360 && quality !== 720) throw new AppError("INVALID_QUALITY", "Chất lượng cần là 360p hoặc 720p.");
    if (relayMode() === "frontend") return await forwardHome(request, "video", session, { url: id, mode, quality });
    const source = await resolveVideo(id, mode, quality, session, playbackOrigin(request), request.signal);
    return privateJson(source);
  } catch (error) { return errorResponse(error); }
}
