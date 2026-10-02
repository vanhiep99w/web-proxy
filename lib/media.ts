import { openToken, sealToken, type Session } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import type { ByteRange } from "@/lib/range";

export type MediaTicket = { url: string; total: number; mime: string; sid: string; exp: number };

export function validateMediaUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("INVALID_STREAM", "URL luồng không hợp lệ.", 502); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !url.hostname.endsWith(".googlevideo.com") || url.pathname !== "/videoplayback" || value.length > 10000) {
    throw new AppError("INVALID_STREAM", "Server từ chối địa chỉ luồng không thuộc YouTube.", 502);
  }
  return url;
}

export function mintMediaTicket(data: MediaTicket) {
  validateMediaUrl(data.url);
  return sealToken("media", data);
}

export function readMediaTicket(token: string, session: Session, now = Date.now()): MediaTicket {
  const data = openToken("media", token) as Partial<MediaTicket> | null;
  if (!data || data.sid !== session.sid || typeof data.url !== "string" ||
      !Number.isSafeInteger(data.total) || (data.total as number) <= 0 ||
      typeof data.mime !== "string" || !/^(audio|video)\/mp4(?:; codecs="[A-Za-z0-9., -]+")?$/.test(data.mime) ||
      !Number.isSafeInteger(data.exp)) {
    throw new AppError("INVALID_TOKEN", "Luồng không thuộc phiên truy cập này.", 403);
  }
  if ((data.exp as number) <= Math.floor(now / 1000) || (data.exp as number) > session.exp) {
    throw new AppError("STREAM_EXPIRED", "Luồng đã hết hạn. Hãy bấm Lấy lại luồng.", 410);
  }
  validateMediaUrl(data.url);
  return data as MediaTicket;
}

const STREAM_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Encoding": "identity",
};

export async function fetchMediaRange(value: string, range: ByteRange, total: number, signal?: AbortSignal): Promise<Response> {
  let url = validateMediaUrl(value);
  const timeout = AbortSignal.timeout(35000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      // Googlevideo supports the signed URL's `range` query; some clients ignore Range alone.
      url.searchParams.set("range", `${range.start}-${range.end}`);
      const response = await fetch(url, {
        // Do NOT also send Range: that can range the already sliced resource a second time.
        headers: STREAM_HEADERS,
        signal: combined, cache: "no-store", redirect: "manual",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new AppError("UPSTREAM_FAILED", "YouTube trả về chuyển hướng không hợp lệ.", 502);
        // Validate every redirect BEFORE fetching it. Never relay arbitrary URLs or headers.
        url = validateMediaUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 403 || response.status === 429) {
          throw new AppError("UPSTREAM_BLOCKED", "YouTube từ chối luồng từ IP máy xử lý media. Kiểm tra mạng của backend đang sử dụng.", 502);
        }
        if (response.status === 404 || response.status === 410) {
          throw new AppError("STREAM_EXPIRED", "Luồng không còn khả dụng. Hãy lấy lại luồng.", 410);
        }
        throw new AppError("UPSTREAM_FAILED", "Không thể đọc đoạn video từ YouTube.", 502);
      }
      const length = Number(response.headers.get("content-length"));
      const contentRange = response.headers.get("content-range");
      const correctRange = response.status === 206 && contentRange === `bytes ${range.start}-${range.end}/${total}`;
      const queryRange = response.status === 200 && length === range.length;
      if ((!correctRange && !queryRange) || (length && length !== range.length) || !response.body) {
        await response.body?.cancel();
        throw new AppError("UPSTREAM_RANGE_FAILED", "YouTube không trả về đúng đoạn byte yêu cầu.", 502);
      }
      return response;
    }
    throw new AppError("UPSTREAM_FAILED", "Luồng có quá nhiều chuyển hướng.", 502);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (combined.aborted) throw new AppError("UPSTREAM_TIMEOUT", "Kết nối YouTube quá lâu hoặc đã bị hủy. Hãy thử lại.", 504);
    throw new AppError("UPSTREAM_FAILED", "Không kết nối được tới máy chủ video.", 502);
  }
}

export function boundedMediaBody(body: ReadableStream<Uint8Array>, expected: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let remaining = expected;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (remaining) controller.error(new Error("Incomplete upstream segment"));
          else controller.close();
          return;
        }
        if (value.byteLength > remaining) {
          await reader.cancel();
          controller.error(new Error("Oversized upstream segment"));
          return;
        }
        remaining -= value.byteLength;
        controller.enqueue(value);
        if (!remaining) {
          await reader.cancel();
          controller.close();
        }
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
}
