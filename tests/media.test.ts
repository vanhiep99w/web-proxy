import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedMediaBody, fetchMediaRange, validateMediaUrl } from "@/lib/media";
import { evaluatePlayer } from "@/lib/evaluator";

afterEach(() => vi.unstubAllGlobals());
const source = "https://rr1---sn-example.googlevideo.com/videoplayback?itag=140";
const range = { start: 2, end: 4, length: 3 };

describe("media allowlist and upstream fetch", () => {
  it("accepts only a Google-owned HTTPS stream path", () => expect(validateMediaUrl(source).hostname).toBe("rr1---sn-example.googlevideo.com"));
  it.each([
    "https://googlevideo.com/videoplayback", "https://googlevideo.com.evil.test/videoplayback",
    "http://rr1.googlevideo.com/videoplayback", "https://rr1.googlevideo.com:8443/videoplayback",
    "https://rr1.googlevideo.com/admin", "https://user:pass@rr1.googlevideo.com/videoplayback", "https://127.0.0.1/videoplayback",
  ])("rejects %s", (value) => expect(() => validateMediaUrl(value)).toThrow());
  it("does not follow redirects outside the allowlist", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchMediaRange(source, range, 10)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("adds the requested range without forwarding browser credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "3" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await fetchMediaRange(source, range, 10);
    expect(response.ok).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect((url as URL).searchParams.get("range")).toBe("2-4");
    expect(options.redirect).toBe("manual");
    expect(options.headers.Range).toBeUndefined();
    expect(options.headers.Cookie).toBeUndefined();
    expect(options.headers.Authorization).toBeUndefined();
  });
  it("rejects ignored ranges and classifies bot blocking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(10), { headers: { "content-length": "10" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchMediaRange(source, range, 10)).rejects.toMatchObject({ code: "UPSTREAM_RANGE_FAILED" });
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(fetchMediaRange(source, range, 10)).rejects.toMatchObject({ code: "UPSTREAM_BLOCKED" });
  });
  it("checks exact Content-Range on 206", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(3), { status: 206, headers: { "content-range": "bytes 2-4/10" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchMediaRange(source, range, 10)).status).toBe(206);
    fetchMock.mockResolvedValue(new Response(new Uint8Array(3), { status: 206, headers: { "content-range": "bytes 0-2/10" } }));
    await expect(fetchMediaRange(source, range, 10)).rejects.toThrow();
  });
});

function stream(...chunks: number[][]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk)); controller.close(); } });
}
describe("bounded streaming", () => {
  it("returns exactly the requested bytes", async () => {
    const result = await new Response(boundedMediaBody(stream([1, 2], [3]), 3)).arrayBuffer();
    expect([...new Uint8Array(result)]).toEqual([1, 2, 3]);
  });
  it("rejects truncated or oversized upstream responses", async () => {
    await expect(new Response(boundedMediaBody(stream([1]), 3)).arrayBuffer()).rejects.toThrow();
    await expect(new Response(boundedMediaBody(stream([1, 2, 3, 4]), 3)).arrayBuffer()).rejects.toThrow();
  });
});

describe("QuickJS player evaluator", () => {
  it("returns only the primitive signature fields", async () => {
    expect(await evaluatePlayer('({ sig: "decoded", n: "token", ignored: "secret" })')).toEqual({ sig: "decoded", n: "token" });
  });
  it("does not expose Node.js or browser network primitives", async () => {
    expect(await evaluatePlayer('({ sig: typeof process, n: typeof fetch })')).toEqual({ sig: "undefined", n: "undefined" });
    await expect(evaluatePlayer('require("node:fs")')).rejects.toThrow();
  });
});
