import { describe, expect, it } from "vitest";
import { formatDuration, parseVideoId } from "@/lib/video-id";
import { parseHistory } from "@/lib/history";

const id = "jNQXAC9IVRw";
describe("YouTube URL parser", () => {
  it.each([
    id, `https://www.youtube.com/watch?v=${id}&list=anything&t=10`,
    `youtu.be/${id}?si=tracking`, `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`, `https://youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`, `https://www.youtube-nocookie.com/embed/${id}`,
    `https://youtube.com/live/${id}`, `  ${id}  `,
  ])("extracts IDs from %s", (value) => expect(parseVideoId(value)).toBe(id));
  it.each([
    "", undefined, 123, "https://youtube.com.evil.test/watch?v=jNQXAC9IVRw",
    "https://evil.test/?v=jNQXAC9IVRw", "https://youtube.com@127.0.0.1/watch?v=jNQXAC9IVRw",
    "https://user:password@youtube.com/watch?v=jNQXAC9IVRw", "https://youtube.com:8443/watch?v=jNQXAC9IVRw",
    "file:///etc/passwd", "https://youtube.com/watch?v=short", "x".repeat(2049),
  ])("rejects unsafe or invalid input %s", (value) => expect(() => parseVideoId(value)).toThrow());
  it("formats durations", () => {
    expect(formatDuration(19)).toBe("0:19");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("local history", () => {
  it("discards invalid rows, duplicates, and untrusted thumbnail URLs", () => {
    const item = { id, title: "Test", author: "Author", duration: 19, playedAt: 10, thumbnail: "https://evil.test/track" };
    const history = parseHistory(JSON.stringify([item, item, { ...item, id: "bad" }]));
    expect(history).toHaveLength(1);
    expect(history[0].thumbnail).toBe(`/api/thumbnail?id=${id}`);
  });
  it.each([null, "bad", "{}", "x".repeat(100001)])("handles corrupt or missing storage", (value) => expect(parseHistory(value)).toEqual([]));
});
