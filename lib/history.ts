import type { HistoryItem } from "@/lib/types";
import { VIDEO_ID } from "@/lib/video-id";

export const HISTORY_KEY = "relay:history:v1";

export function parseHistory(value: string | null): HistoryItem[] {
  if (!value || value.length > 100000) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((item): item is HistoryItem => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<HistoryItem>;
      if (typeof row.id !== "string" || !VIDEO_ID.test(row.id) || seen.has(row.id) ||
          typeof row.title !== "string" || row.title.length > 1000 ||
          typeof row.author !== "string" || row.author.length > 500 ||
          typeof row.duration !== "number" || !Number.isFinite(row.duration) || row.duration < 0 ||
          typeof row.playedAt !== "number" || !Number.isFinite(row.playedAt)) return false;
      seen.add(row.id);
      return true;
    }).slice(0, 12).map((item) => ({
      id: item.id, title: item.title, author: item.author, duration: item.duration,
      playedAt: item.playedAt,
      // Never trust a URL read from localStorage; all thumbnails are same-origin.
      thumbnail: `/api/thumbnail?id=${item.id}`,
    }));
  } catch { return []; }
}
