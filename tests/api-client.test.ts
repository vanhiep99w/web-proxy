import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/api-client";
import { normalizeApiOrigin } from "@/lib/api-origin";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const origin = "https://relay-api.example";
const session = () => ({ token: "a".repeat(100), expiresAt: Math.floor(Date.now() / 1000) + 60 });

describe("direct Worker API client", () => {
  it.each(["https://api.example/path", "https://user:pass@api.example", "https://api.example?key=secret", "https://api.example/#hash", "http://api.example", "javascript:alert(1)", "https://api.example/; connect-src *", "https://*.workers.dev", "https://api.example;script-src"])("rejects unsafe API origins: %s", (value) => {
    expect(() => normalizeApiOrigin(value)).toThrow();
  });
  it("allows HTTPS origins and explicit HTTP loopback for development", () => {
    expect(normalizeApiOrigin(origin + "/")).toBe(origin);
    expect(normalizeApiOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });
  it("calls the Worker directly with bearer auth and without cookies", async () => {
    const api = new ApiClient(origin);
    const value = session(); api.acceptSession(value);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await api.request("/api/video", { method: "POST", headers: { "Content-Type": "application/json" } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(origin + "/api/video");
    expect(init.headers.get("authorization")).toBe("Bearer " + value.token);
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(url).not.toContain(value.token);
  });
  it("does not leak credentials to an unexpected DASH URL", () => {
    const api = new ApiClient(origin); api.acceptSession(session());
    for (const url of ["https://evil.test/api/stream", "https://rr1.googlevideo.com/videoplayback", origin + "/anything", "https://user:pass@relay-api.example/api/stream", "blob:some-manifest"]) {
      expect(api.authorizationFor(url)).toBeUndefined();
    }
    expect(api.authorizationFor(origin + "/api/stream?ticket=abc")).toMatch(/^Bearer /);
  });
  it("expires and clears the in-memory token", async () => {
    vi.useFakeTimers();
    const api = new ApiClient(origin); api.acceptSession(session());
    vi.advanceTimersByTime(61000);
    expect(api.authorizationFor(origin + "/api/video")).toBeUndefined();
    expect(api.expiresAt).toBe(0);
    api.acceptSession(session());
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await api.lock();
    expect(fetcher).not.toHaveBeenCalled();
    expect(api.authorizationFor(origin + "/api/stream")).toBeUndefined();
  });
  it("never accepts URL paths or invalid sessions supplied by a caller", () => {
    const api = new ApiClient(origin);
    for (const path of ["https://evil.test/api/video", "//evil.test/api/video", "/api/../admin", "/api/auth#fragment"]) expect(() => api.url(path)).toThrow();
    for (const value of [{}, { token: "invalid", expiresAt: 1 }, { ...session(), expiresAt: Math.floor(Date.now() / 1000) + 100000 }]) expect(() => api.acceptSession(value)).toThrow();
  });
  it("retains same-origin cookie behavior in standalone/home mode", async () => {
    const api = new ApiClient();
    api.acceptSession({});
    const fetcher = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await api.lock();
    expect(fetcher.mock.calls[0][0]).toBe("/api/auth");
    expect(fetcher.mock.calls[0][1].credentials).toBe("same-origin");
    expect(fetcher.mock.calls[0][1].headers.has("authorization")).toBe(false);
  });
});
