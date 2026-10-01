import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login, DELETE as logout } from "@/app/api/auth/route";
import { GET as stream, HEAD as streamHead } from "@/app/api/stream/route";
import { POST as video } from "@/app/api/video/route";
import { COOKIE_NAME, createSession, sealToken } from "@/lib/auth";
import { mintMediaTicket } from "@/lib/media";

vi.mock("@/lib/youtube", () => ({ resolveVideo: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("ACCESS_PASSWORD", "random-password-at-least-16");
  vi.stubEnv("AUTH_SECRET", "random-secret-at-least-32-characters-for-testing");
});
const base = "https://relay.test";
const session = () => {
  const data = createSession();
  return { data, cookie: `${COOKIE_NAME}=${sealToken("session", data)}` };
};

describe("private routes", () => {
  it("refuses unauthenticated video and media requests", async () => {
    expect((await stream(new Request(`${base}/api/stream?url=https://example.com`))).status).toBe(401);
    expect((await video(new Request(`${base}/api/video`, { method: "POST", headers: { Origin: base } }))).status).toBe(401);
  });
  it("rejects cross-origin logins and logout", async () => {
    const request = (method: string) => new Request(`${base}/api/auth`, { method, headers: { Origin: "https://evil.test", "Content-Type": "application/json" }, ...(method === "POST" ? { body: '{"password":"random-password-at-least-16"}' } : {}) });
    expect((await login(request("POST"))).status).toBe(403);
    expect((await logout(request("DELETE"))).status).toBe(403);
  });
  it("sets an HttpOnly session only on a valid password", async () => {
    const make = (password: string) => new Request(`${base}/api/auth`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const bad = await login(make("wrong"));
    expect(bad.status).toBe(401);
    expect(bad.headers.has("set-cookie")).toBe(false);
    const good = await login(make("random-password-at-least-16"));
    expect(good.status).toBe(200);
    expect(good.headers.get("set-cookie")).toContain("HttpOnly");
    expect(good.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not accept an arbitrary URL parameter as stream authority", async () => {
    const { cookie } = session();
    const response = await stream(new Request(`${base}/api/stream?url=https://example.com`, { headers: { Cookie: cookie } }));
    expect(response.status).toBe(403);
  });
  it("HEAD validates ticket and session without contacting upstream", async () => {
    const { cookie, data } = session();
    const ticket = mintMediaTicket({ url: "https://rr1.googlevideo.com/videoplayback?itag=140", total: 100, mime: "audio/mp4", sid: data.sid, exp: data.exp });
    const response = await streamHead(new Request(`${base}/api/stream?ticket=${ticket}`, { method: "HEAD", headers: { Cookie: cookie } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("100");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    const invalid = await stream(new Request(`${base}/api/stream?ticket=${ticket}`, { headers: { Cookie: cookie, Range: "bytes=150-" } }));
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */100");
  });
  it("validates video input before calling the resolver", async () => {
    const { cookie } = session();
    const response = await video(new Request(`${base}/api/video`, { method: "POST", headers: { Origin: base, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1/admin" }) }));
    expect(response.status).toBe(400);
  });
});
