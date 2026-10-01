import { requireSession } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { boundedMediaBody, fetchMediaRange, readMediaTicket } from "@/lib/media";
import { parseRange } from "@/lib/range";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function serve(request: Request, head: boolean) {
  let total: number | undefined;
  try {
    const session = requireSession(request);
    consumeRateLimit(`stream:${session.sid}`, 240, 60_000);
    const url = new URL(request.url);
    const ticket = url.searchParams.get("ticket");
    if (!ticket) throw new AppError("INVALID_TOKEN", "Thiếu quyền truy cập luồng.", 403);
    const media = readMediaTicket(ticket, session);
    total = media.total;
    const headers = new Headers({
      "Content-Type": media.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Vary": "Cookie, Range",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (head && !request.headers.has("range")) {
      headers.set("Content-Length", String(total));
      return new Response(null, { headers });
    }
    const range = parseRange(request.headers.get("range"), total);
    headers.set("Content-Length", String(range.length));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    if (head) return new Response(null, { status: 206, headers });
    const upstream = await fetchMediaRange(media.url, range, total, request.signal);
    return new Response(boundedMediaBody(upstream.body!, range.length), { status: 206, headers });
  } catch (error) {
    const response = errorResponse(error);
    if (error instanceof AppError && error.status === 416 && total) response.headers.set("Content-Range", `bytes */${total}`);
    return head ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
}

export const GET = (request: Request) => serve(request, false);
export const HEAD = (request: Request) => serve(request, true);
