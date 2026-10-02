import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as authStatus, POST as login, DELETE as logout } from "@/app/api/auth/route";
import { POST as video } from "@/app/api/video/route";
import { GET as stream, HEAD as head } from "@/app/api/stream/route";
import { GET as thumbnail } from "@/app/api/thumbnail/route";
import { GET as backend } from "@/app/api/backend/route";
import { createSession, COOKIE_NAME, sealToken } from "@/lib/auth";
import { apiSession, playbackOrigin, relayMode } from "@/lib/relay-mode";
import { homeBackendUrl } from "@/lib/home-proxy";
import { mintMediaTicket } from "@/lib/media";
import { resolveVideo } from "@/lib/youtube";

vi.mock("@/lib/youtube", () => ({ resolveVideo: vi.fn() }));
const origin = "https://frontend.test";
const home = "https://home.example.test";
const serviceKey = "test-home-backend-key-at-least-32-characters";
const token = "a".repeat(64);
const id = "jNQXAC9IVRw";
const session = createSession();
function browserHeaders() {
  return { Cookie: `${COOKIE_NAME}=${sealToken("session", session)}`, Origin: origin, "Content-Type": "application/json" };
}
function serviceHeaders() {
  return { Authorization: `Bearer ${serviceKey}`, "X-Relay-Session-Id": session.sid, "X-Relay-Session-Expires": String(session.exp), "X-Relay-Frontend-Origin": origin, "Content-Type": "application/json" };
}
function videoRequest(headers: HeadersInit = browserHeaders()) {
  return new Request(`${origin}/api/video`, { method: "POST", headers, body: JSON.stringify({ url: id, mode: "video", quality: 360 }) });
}
function source(url = `${origin}/api/stream?ticket=${token}`) {
  return { id, title: "Me at the zoo", author: "jawed", duration: 19, thumbnail: `/api/thumbnail?id=${id}`, mode: "video" as const, quality: "Tối đa 360p", expiresAt: session.exp - 10, manifest: `<MPD><BaseURL>${url}</BaseURL></MPD>` };
}
beforeEach(() => {
  vi.stubEnv("RELAY_MODE", "home");
  vi.stubEnv("HOME_BACKEND_KEY", serviceKey);
  vi.stubEnv("HOME_BACKEND_URL", home);
  vi.stubEnv("ACCESS_PASSWORD", "abc");
  vi.stubEnv("AUTH_SECRET", "test-auth-secret-at-least-32-characters");
  vi.stubEnv("VERCEL", "");
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("private home backend", () => {
  it("disables all password-gate methods on the exposed backend", async () => {
    for (const [method, handler] of [["GET", authStatus], ["POST", login], ["DELETE", logout]] as const) {
      expect((await handler(new Request(`${home}/api/auth`, { method }))).status).toBe(404);
    }
  });
  it("rejects anonymous requests and browser cookies on every home endpoint", async () => {
    for (const handler of [stream, thumbnail, backend]) {
      expect((await handler(new Request(`${home}/api/stream`, { headers: browserHeaders() }))).status).toBe(403);
    }
    expect((await video(videoRequest())).status).toBe(403);
    expect(resolveVideo).not.toHaveBeenCalled();
  });
  it("accepts a service-authenticated context, not arbitrary cookie authority", () => {
    expect(apiSession(new Request(home, { headers: serviceHeaders() }))).toEqual(session);
    for (const change of [{ Authorization: "Bearer wrong" }, { "X-Relay-Session-Id": "bad" }, { "X-Relay-Session-Expires": "1" }, { "X-Relay-Session-Expires": String(session.exp + 86400) }]) {
      expect(() => apiSession(new Request(home, { headers: { ...serviceHeaders(), ...change } }))).toThrow();
    }
  });
  it("uses the frontend origin for home-issued DASH stream URLs", async () => {
    vi.mocked(resolveVideo).mockResolvedValue(source());
    const result = await video(videoRequest(serviceHeaders()));
    expect(result.status).toBe(200);
    expect(resolveVideo).toHaveBeenCalledWith(id, "video", 360, session, origin, expect.any(AbortSignal));
  });
  it("rejects session-mismatched media tickets even with a valid service key", async () => {
    const another = createSession();
    const ticket = mintMediaTicket({ url: "https://rr1.googlevideo.com/videoplayback", total: 100, mime: "audio/mp4", sid: another.sid, exp: session.exp });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await stream(new Request(`${home}/api/stream?ticket=${ticket}`, { headers: { ...serviceHeaders(), Range: "bytes=0-0" } }));
    expect(result.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("checks readiness only with a service key and does not disclose credentials", async () => {
    const result = await backend(new Request(`${home}/api/backend`, { headers: { Authorization: `Bearer ${serviceKey}` } }));
    expect(result.status).toBe(200);
    const text = await result.text();
    expect(JSON.parse(text)).toMatchObject({ connected: true, mode: "home" });
    expect(text).not.toContain(serviceKey);
    expect(text).not.toContain(process.env.AUTH_SECRET);
  });
  it("fails closed for unknown roles, short service keys and unsafe origins", () => {
    vi.stubEnv("RELAY_MODE", "typo"); expect(() => relayMode()).toThrow();
    vi.stubEnv("RELAY_MODE", "home");
    vi.stubEnv("HOME_BACKEND_KEY", "abc"); expect(() => apiSession(new Request(home, { headers: serviceHeaders() }))).toThrow();
    for (const value of ["http://remote.test", "https://user:pass@frontend.test", "https://frontend.test/path", "null"]) {
      expect(() => playbackOrigin(new Request(home, { headers: { "X-Relay-Frontend-Origin": value } }))).toThrow();
    }
  });
});

describe("Vercel to home relay", () => {
  beforeEach(() => vi.stubEnv("RELAY_MODE", "frontend"));
  it("requires the browser session even when the caller supplies a service key", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await video(videoRequest({ ...serviceHeaders(), Origin: origin }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("resolves exclusively through home and strips browser credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(source())); vi.stubGlobal("fetch", fetcher);
    const result = await video(videoRequest());
    expect(result.status).toBe(200);
    expect(result.headers.get("x-relay-backend")).toBe("home");
    expect(resolveVideo).not.toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${home}/api/video`);
    expect(init.headers.get("Authorization")).toBe(`Bearer ${serviceKey}`);
    expect(init.headers.get("Cookie")).toBeNull();
    expect(init.headers.get("X-Relay-Session-Id")).toBe(session.sid);
    expect(init.headers.get("X-Relay-Frontend-Origin")).toBe(origin);
    expect(JSON.parse(init.body)).toEqual({ url: id, mode: "video", quality: 360 });
    expect(init.redirect).toBe("manual");
  });
  it("relays bounded bytes and only whitelisted response headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("abc", { status: 206, headers: {
      "Content-Type": "audio/mp4", "Content-Length": "3", "Content-Range": "bytes 0-2/100",
      "Set-Cookie": "leaked=secret", "Authorization": `Bearer ${serviceKey}`, "X-Relay-Session-Id": session.sid,
    } })); vi.stubGlobal("fetch", fetcher);
    const result = await stream(new Request(`${origin}/api/stream?ticket=${token}&url=https://evil.test`, { headers: { ...browserHeaders(), Range: "bytes=0-2" } }));
    expect(result.status).toBe(206); expect(await result.text()).toBe("abc");
    expect(result.headers.get("content-range")).toBe("bytes 0-2/100");
    expect(result.headers.has("set-cookie")).toBe(false); expect(result.headers.has("authorization")).toBe(false);
    expect(result.headers.has("x-relay-session-id")).toBe(false);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${home}/api/stream?ticket=${token}`);
    expect(fetcher.mock.calls[0][1].headers.get("range")).toBe("bytes=0-2");
  });
  it("relays HEAD without reading a body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { headers: { "Content-Type": "audio/mp4", "Content-Length": "99999999" } })); vi.stubGlobal("fetch", fetcher);
    const result = await head(new Request(`${origin}/api/stream?ticket=${token}`, { method: "HEAD", headers: browserHeaders() }));
    expect(result.status).toBe(200); expect(result.headers.get("content-length")).toBe("99999999");
    expect((await result.arrayBuffer()).byteLength).toBe(0);
    expect(fetcher.mock.calls[0][1].method).toBe("HEAD");
  });
  it("rejects a wrong range, missing length, and oversized upstream chunks", async () => {
    const fixtures: Record<string, string>[] = [
      { "Content-Length": "3", "Content-Range": "bytes 5-7/100" },
      { "Content-Range": "bytes 0-2/100" },
      { "Content-Length": "9999999", "Content-Range": "bytes 0-9999998/9999999" },
    ];
    for (const headers of fixtures) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("abc", { status: 206, headers: { ...headers, "Content-Type": "audio/mp4" } })));
      const result = await stream(new Request(`${origin}/api/stream?ticket=${token}`, { headers: { ...browserHeaders(), Range: "bytes=0-2" } }));
      expect(result.status).toBe(502);
    }
  });
  it("proxies thumbnails through home, never directly from Vercel", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("abc", { headers: { "Content-Type": "image/jpeg", "Content-Length": "3" } })); vi.stubGlobal("fetch", fetcher);
    const result = await thumbnail(new Request(`${origin}/api/thumbnail?id=${id}`, { headers: browserHeaders() }));
    expect(result.status).toBe(200); expect(await result.text()).toBe("abc");
    expect(String(fetcher.mock.calls[0][0])).toBe(`${home}/api/thumbnail?id=${id}`);
  });
  it("never follows redirects with the shared key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://evil.test" } })); vi.stubGlobal("fetch", fetcher);
    expect((await video(videoRequest())).status).toBe(502); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects manifests which would make the browser contact another origin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(source(`https://googlevideo.com/api/stream?ticket=${token}`))));
    expect((await video(videoRequest())).status).toBe(502);
  });
  it("preserves upstream rejection and gives a separate offline diagnostic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "UPSTREAM_BLOCKED", message: "YouTube từ chối IP." } }, { status: 422 })));
    const blocked = await video(videoRequest()); expect(blocked.status).toBe(422); expect((await blocked.json()).error.code).toBe("UPSTREAM_BLOCKED");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret network detail")));
    const offline = await video(videoRequest()); expect(offline.status).toBe(502); expect((await offline.json()).error.code).toBe("HOME_UNREACHABLE");
    expect(resolveVideo).not.toHaveBeenCalled();
  });
  it("maps wrong service credentials to a backend error, not user logout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "HOME_KEY_DENIED", message: "wrong key" } }, { status: 403 })));
    const result = await video(videoRequest()); expect(result.status).toBe(502); expect((await result.json()).error.code).toBe("HOME_CONFIGURATION_ERROR");
  });
  it("rejects unsafe backend URLs and localhost on Vercel", () => {
    for (const url of ["http://remote.test", "https://user:pass@home.test", "https://home.test/api", "https://home.test/?key=secret", "https://home.test/#fragment"]) {
      vi.stubEnv("HOME_BACKEND_URL", url); expect(() => homeBackendUrl()).toThrow();
    }
    vi.stubEnv("HOME_BACKEND_URL", "http://127.0.0.1:3001"); expect(homeBackendUrl().hostname).toBe("127.0.0.1");
    vi.stubEnv("VERCEL", "1"); expect(() => homeBackendUrl()).toThrow();
  });
});
