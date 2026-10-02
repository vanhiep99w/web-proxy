import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseSession } from "@/lib/auth";
import { mintMediaTicket } from "@/lib/media";

const api = "https://worker.example";
const origin = "https://vercel.example";
const password = "worker-runtime-password";
const secret = "worker-runtime-secret-at-least-32-characters";
let runtime: Miniflare;
let production: Miniflare;
let token = "";
let upstreamCalls = 0;

function build(outdir: string, main?: string) {
  execFileSync(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "deploy", ...(main ? [main] : []), "--dry-run", "--outdir", outdir], {
    env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false" }, stdio: "pipe",
  });
}

function makeRuntime(dir: string) {
  const root = resolve(dir);
  const files = readdirSync(root);
  const entry = files.find((file) => file.endsWith(".js"))!;
  return new Miniflare(convertV4MiniflareOptions({
    modules: [
      { type: "ESModule", path: resolve(root, entry) },
      ...files.filter((file) => file.endsWith(".wasm")).map((file) => ({ type: "CompiledWasm" as const, path: resolve(root, file) })),
    ],
    modulesRoot: root,
    compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"],
    bindings: { RELAY_MODE: "worker", ACCESS_PASSWORD: password, AUTH_SECRET: secret, FRONTEND_ORIGINS: origin },
    ratelimits: { LOGIN_RATE_LIMITER: { namespace_id: "1001", simple: { limit: 8, period: 60 } } },
    outboundService: async (request) => {
      upstreamCalls++;
      const url = new URL(request.url);
      if (url.hostname === "i.ytimg.com") return new RuntimeResponse("jpg", { headers: { "Content-Type": "image/jpeg", "Content-Length": "3" } });
      if (!url.hostname.endsWith(".googlevideo.com") || url.pathname !== "/videoplayback") throw new Error("Unexpected upstream");
      // The resolver's signed query range must be preserved without a second Range header.
      if (url.searchParams.get("range") !== "0-2" || request.headers.has("authorization") || request.headers.has("cookie") || request.headers.has("range")) throw new Error("Leaked credentials or incorrect range");
      return new RuntimeResponse("abc", { status: 206, headers: { "Content-Range": "bytes 0-2/100", "Content-Length": "3" } });
    },
  }));
}

function call(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return runtime.dispatchFetch(api + path, { ...init, headers: { Origin: origin, Authorization: "Bearer " + token, ...Object.fromEntries(new Headers(init.headers)) } });
}

beforeAll(async () => {
  vi.stubEnv("ACCESS_PASSWORD", password); vi.stubEnv("AUTH_SECRET", secret);
  build(".wrangler/runtime-tests", "tests/fixtures/worker-runtime.ts");
  // A positional entrypoint keeps its basename in Wrangler's output.
  runtime = makeRuntime(".wrangler/runtime-tests");
  const response = await call("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  expect(response.status).toBe(200);
  const body = await response.json() as { token: string };
  token = body.token;
}, 30000);
afterAll(async () => {
  await runtime?.dispose(); await production?.dispose(); vi.unstubAllEnvs();
});

describe("actual Cloudflare workerd runtime", () => {
  it("loads the Cloudflare SDK platform and precompiled QuickJS WASM", async () => {
    expect(await (await call("/__test/platform")).json()).toEqual({ runtime: "cf-worker" });
    const response = await call("/__test/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: '({sig:"decoded",n:"throttle"})' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { sig: "decoded", n: "throttle" } });
  });
  it("isolates player code and stops infinite loops even with a frozen Worker clock", async () => {
    for (const code of ['({sig:typeof process,n:typeof fetch})', '({sig:typeof require,n:typeof globalThis.process})']) {
      const response = await call("/__test/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      expect(await response.json()).toEqual({ result: { sig: "undefined", n: "undefined" } });
    }
    const response = await call("/__test/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "while(true) {}" }) });
    expect(response.status).toBe(422);
  });
  it("uses bearer auth, never cookies, with exact CORS headers", async () => {
    const response = await call("/api/backend");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connected: true, mode: "cloudflare" });
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
    const cookieOnly = await call("/api/backend", { headers: { Authorization: "", Cookie: "relay_session=" + token } });
    expect(cookieOnly.status).toBe(401);
    expect(cookieOnly.headers.get("access-control-allow-origin")).toBe(origin);
  });
  it("handles Authorization and Range preflights without authentication", async () => {
    const response = await call("/api/stream", { method: "OPTIONS", headers: { Authorization: "", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,range" } });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("Range");
    const denied: Record<string, string>[] = [{ "Access-Control-Request-Method": "PUT" }, { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-relay-secret" }];
    for (const headers of denied) {
      expect((await call("/api/stream", { method: "OPTIONS", headers })).status).toBe(403);
    }
  });
  it("rejects unknown origins before contacting any upstream", async () => {
    const count = upstreamCalls;
    for (const Origin of ["https://evil.test", "null", ""]) {
      const response = await call("/api/thumbnail?id=jNQXAC9IVRw", { headers: { Origin } });
      expect(response.status).toBe(403);
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
    }
    expect(upstreamCalls).toBe(count);
  });
  it("streams only session-bound ranges without leaking bearer tokens upstream", async () => {
    const session = parseSession(token)!;
    const ticket = mintMediaTicket({ url: "https://rr1.googlevideo.com/videoplayback?itag=140", total: 100, mime: "audio/mp4", sid: session.sid, exp: session.exp });
    const response = await call("/api/stream?ticket=" + ticket, { headers: { Range: "bytes=0-2" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-2/100");
    expect(response.headers.get("access-control-expose-headers")).toContain("Content-Range");
    expect(await response.text()).toBe("abc");
    const count = upstreamCalls;
    const head = await call("/api/stream?ticket=" + ticket, { method: "HEAD", headers: { Range: "bytes=0-2" } });
    expect(head.status).toBe(206);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect(upstreamCalls).toBe(count);
    expect((await call("/api/stream?ticket=" + ticket, { headers: { Range: "bytes=200-300" } })).status).toBe(416);
  });
  it("fetches thumbnails through the Worker and makes errors readable cross-origin", async () => {
    const response = await call("/api/thumbnail?id=jNQXAC9IVRw");
    expect(response.status).toBe(200); expect(await response.text()).toBe("jpg");
    const invalid = await call("/api/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://evil.test" }) });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("access-control-allow-origin")).toBe(origin);
  });
  it("limits repeated password guesses with the platform binding", async () => {
    const responses = [];
    for (let attempt = 0; attempt < 10; attempt++) responses.push(await call("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }));
    expect(responses.at(-1)?.status).toBe(429);
  });
  it("does not ship the test evaluator endpoint in the production bundle", async () => {
    build(".wrangler/production-tests");
    production = makeRuntime(".wrangler/production-tests");
    const response = await production.dispatchFetch(api + "/__test/platform", { headers: { Origin: origin } });
    expect(response.status).toBe(404);
  }, 15000);
});
