import { AppError } from "@/lib/errors";

export const MAX_SEGMENT_BYTES = 4 * 1024 * 1024;
export type ByteRange = { start: number; end: number; length: number };

export function parseRange(header: string | null, total: number, limit = MAX_SEGMENT_BYTES): ByteRange {
  if (!Number.isSafeInteger(total) || total <= 0) throw new AppError("INVALID_STREAM", "Kích thước luồng không hợp lệ.", 502);
  if (!header) throw new AppError("RANGE_REQUIRED", "Luồng này chỉ hỗ trợ đọc theo từng đoạn byte.");
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) throw new AppError("INVALID_RANGE", "Byte range không hợp lệ.", 416);
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))) {
    throw new AppError("INVALID_RANGE", "Byte range không hợp lệ.", 416);
  }
  let start: number;
  let end: number;
  if (first === undefined) {
    if (!last || last <= 0) throw new AppError("INVALID_RANGE", "Byte range không hợp lệ.", 416);
    start = Math.max(0, total - last);
    end = total - 1;
  } else {
    start = first;
    end = Math.min(last ?? start + limit - 1, total - 1);
  }
  if (start >= total || end < start) throw new AppError("INVALID_RANGE", "Byte range nằm ngoài luồng.", 416);
  const length = end - start + 1;
  if (length > limit) throw new AppError("SEGMENT_TOO_LARGE", "Đoạn video quá lớn. Hãy chọn 360p hoặc chế độ chỉ nghe.", 413);
  return { start, end, length };
}
