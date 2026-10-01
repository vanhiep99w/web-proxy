import { AppError } from "@/lib/errors";

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"]);

export function parseVideoId(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 2048) {
    throw new AppError("INVALID_VIDEO_URL", "Hãy dán link YouTube hoặc mã video hợp lệ.");
  }
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new AppError("INVALID_VIDEO_URL", "Link YouTube không hợp lệ.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || !HOSTS.has(url.hostname)) {
    throw new AppError("INVALID_VIDEO_URL", "Chỉ hỗ trợ link từ YouTube, không hỗ trợ URL proxy tùy ý.");
  }
  let id: string | null = null;
  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
    id = url.pathname.split("/")[1];
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else {
    const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/);
    id = match?.[1] ?? null;
  }
  if (!id || !VIDEO_ID.test(id)) {
    throw new AppError("INVALID_VIDEO_URL", "Không tìm thấy mã video. Hỗ trợ link watch, youtu.be, Shorts và embed.");
  }
  return id;
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
