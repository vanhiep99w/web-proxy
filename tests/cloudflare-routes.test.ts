import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as authStatus, POST as login, DELETE as logout } from "@/app/api/auth/route";
import { POST as video } from "@/app/api/video/route";
import { GET as stream, HEAD as head } from "@/app/api/stream/route";
import { GET as thumbnail } from "@/app/api/thumbnail/route";
import { GET as backend } from "@/app/api/backend/route";
import { createSession, parseSession, sealToken } from "@/lib/auth";
import { mintMediaTicket } from "@/lib/media";
import { frontendOrigins } from "@/lib/worker-cors";
import { resolveVideo } from "@/lib/youtube";
import { playbackOrigin } from "@/lib/relay-mode";

vi.mock("@/lib/youtube", () => ({ resolveVideo: vi.fn() }));
const api = "https://api.example";
const frontend = "https://frontend.example";
const headers = () => ({ Origin: frontend, Authorization: "Bearer " + sealToken("session", createSession()) });
beforeEach(() => {
  vi.stubEnv("RELAY_MODE", "worker");
  vi.stubEnv("ACCESS_PASSWORD", "abc");
  vi.stubEnv("AUTH_SECRET", "test-cloudflare-secret-at-least-32-characters");
  vi.stubEnv("FRONTEND_ORIGINS", frontend);
});

describe("split deployment routes", () => {
  it("returns a bearer session, never a cross-site cookie", async () => {
    const response = await login(new Request(api + "/api/auth", { method: "POST", headers: { Origin: frontend, "Content-Type": "application/json" }, body: JSON.stringify({ password: "abc" }) }));
    expect(response.status).toBe(200);
    expect(response.headers.has("set-cookie")).toBe(false);
    const body = await response.json();
    expect(parseSession(body.token)?.exp).toBe(body.expiresAt);
  });
  it("requires bearer auth instead of falling back to a cookie", async () => {
    const token = sealToken("session", createSession());
    const request = new Request(api + "/api/auth", { headers: { Origin: frontend, Cookie: "relay_session=" + token } });
    expect(await (await authStatus(request)).json()).toEqual({ authenticated: false });
    expect((await backend(new Request(api + "/api/backend", { headers: { Origin: frontend, Cookie: "relay_session=" + token } }))).status).toBe(401);
  });
  it("denies unknown, missing and wildcard origins", async () => {
    for (const origin of ["https://evil.test", "null", ""]) {
      const response = await login(new Request(api + "/api/auth", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" }));
      expect(response.status).toBe(403);
    }
    for (const origins of ["*", "https://*.vercel.app", "", frontend + ",", "https://frontend.example/path"]) expect(() => frontendOrigins(origins)).toThrow();
    expect(frontendOrigins(frontend + ",http://127.0.0.1:3000")).toHaveLength(2);
  });
  it("builds manifests for the Worker origin, not Vercel or a forwarded host", async () => {
    vi.mocked(resolveVideo).mockResolvedValueOnce({} as Awaited<ReturnType<typeof resolveVideo>>);
    const request = new Request(api + "/api/video", { method: "POST", headers: { ...headers(), "Content-Type": "application/json", "X-Forwarded-Host": "evil.test" }, body: JSON.stringify({ url: "jNQXAC9IVRw" }) });
    expect((await video(request)).status).toBe(200);
    expect(playbackOrigin(request)).toBe(api);
    expect(vi.mocked(resolveVideo).mock.calls.at(-1)?.[4]).toBe(api);
  });
  it("keeps session-bound range validation for Worker HEAD requests", async () => {
    const session = createSession();
    const token = sealToken("session", session);
    const ticket = mintMediaTicket({ url: "https://rr1.googlevideo.com/videoplayback", total: 100, mime: "audio/mp4", sid: session.sid, exp: session.exp });
    const response = await head(new Request(api + "/api/stream?ticket=" + ticket, { method: "HEAD", headers: { Origin: frontend, Authorization: "Bearer " + token, Range: "bytes=0-2" } }));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-2/100");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect((await stream(new Request(api + "/api/stream?ticket=" + ticket, { headers: headers() }))).status).toBe(403);
  });
  it("disables every Vercel API in Cloudflare frontend mode even if old secrets remain", async () => {
    vi.stubEnv("RELAY_MODE", "cloudflare");
    const origin = "https://vercel.example";
    const token = sealToken("session", createSession());
    const request = (path: string, method = "GET") => new Request(origin + path, { method, headers: { Origin: origin, Cookie: "relay_session=" + token } });
    const responses = await Promise.all([
      authStatus(request("/api/auth")), login(request("/api/auth", "POST")), logout(request("/api/auth", "DELETE")),
      video(request("/api/video", "POST")), stream(request("/api/stream")), head(request("/api/stream", "HEAD")),
      thumbnail(request("/api/thumbnail")), backend(request("/api/backend")),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(404));
  });
});
