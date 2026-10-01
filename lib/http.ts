import { AppError } from "@/lib/errors";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const target = new URL(request.url);
  // Next.js can normalize request.url to localhost behind its Node server.
  // Host is the browser's actual target; never trust arbitrary X-Forwarded-Host.
  const host = request.headers.get("host") || target.host;
  const expected = `${target.protocol}//${host}`;
  if (!origin || origin !== expected) {
    throw new AppError("ORIGIN_DENIED", "Yêu cầu phải được gửi từ chính website này.", 403);
  }
}

export async function readJson(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError("INVALID_BODY", "Yêu cầu cần có định dạng JSON.", 415);
  }
  if (Number(request.headers.get("content-length")) > maxBytes) {
    throw new AppError("BODY_TOO_LARGE", "Nội dung yêu cầu quá dài.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_BODY", "Yêu cầu không có nội dung.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new AppError("BODY_TOO_LARGE", "Nội dung yêu cầu quá dài.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid object");
    return data as Record<string, unknown>;
  } catch {
    throw new AppError("INVALID_BODY", "Nội dung JSON không hợp lệ.");
  }
}
