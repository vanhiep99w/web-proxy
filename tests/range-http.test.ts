import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_BYTES, parseRange } from "@/lib/range";
import { assertSameOrigin, readJson } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";


describe("bounded byte ranges", () => {
  it("supports exact, open-ended, and suffix ranges", () => {
    expect(parseRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4, length: 3 });
    expect(parseRange("bytes=2-", 10)).toEqual({ start: 2, end: 9, length: 8 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9, length: 3 });
    expect(parseRange("bytes=0-999", 10)).toEqual({ start: 0, end: 9, length: 10 });
    expect(parseRange("bytes=0-", MAX_SEGMENT_BYTES * 2).length).toBe(MAX_SEGMENT_BYTES);
  });
  it.each([null, "bytes=-", "bytes=-0", "bytes=10-", "bytes=5-2", "bytes=0-1,3-4", "bytes=9007199254740993-", "bytes=x-y"])("rejects invalid ranges %s", (value) => expect(() => parseRange(value, 10)).toThrow());
  it("rejects oversized finite segments rather than corrupting them", () => expect(() => parseRange(`bytes=0-${MAX_SEGMENT_BYTES}`, MAX_SEGMENT_BYTES * 2)).toThrow());
});

describe("request origin and body protection", () => {
  it("accepts only same-origin state changes", () => {
    expect(() => assertSameOrigin(new Request("https://relay.test/api/auth", { headers: { origin: "https://relay.test" } }))).not.toThrow();
    expect(() => assertSameOrigin(new Request("https://relay.test/api/auth", { headers: { origin: "https://evil.test" } }))).toThrow();
    expect(() => assertSameOrigin(new Request("https://relay.test/api/auth"))).toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost:3100/api/auth", { headers: { Host: "127.0.0.1:3100", Origin: "http://127.0.0.1:3100" } }))).not.toThrow();
    expect(() => assertSameOrigin(new Request("https://relay.test/api/auth", { headers: { Origin: "https://evil.test", "X-Forwarded-Host": "evil.test" } }))).toThrow();
  });
  it("parses only JSON objects within the size limit", async () => {
    const make = (body: string, type = "application/json") => new Request("https://relay.test/", { method: "POST", headers: { "Content-Type": type }, body });
    expect(await readJson(make('{"mode":"audio"}'))).toEqual({ mode: "audio" });
    await expect(readJson(make("[]"))).rejects.toThrow();
    await expect(readJson(make("null"))).rejects.toThrow();
    await expect(readJson(make("bad"))).rejects.toThrow();
    await expect(readJson(make("{}", "text/plain"))).rejects.toThrow();
    await expect(readJson(make(`{"big":"${"x".repeat(5000)}"}`))).rejects.toThrow();
  });
  it("enforces a process-local window and allows requests after reset", () => {
    consumeRateLimit("unit-test-bucket", 1, 1000, 100);
    expect(() => consumeRateLimit("unit-test-bucket", 1, 1000, 500)).toThrow();
    expect(() => consumeRateLimit("unit-test-bucket", 1, 1000, 1200)).not.toThrow();
  });
});
