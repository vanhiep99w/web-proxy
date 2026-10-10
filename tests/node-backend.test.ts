import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer, dispatch, type Handler } from "@/backend/server";
import { logEvent } from "@/lib/logging";
import { createSession, sealToken } from "@/lib/auth";

const origin = "https://frontend.example.com";
const servers: ReturnType<typeof createApiServer>[] = [];
let records: string[] = [];
async function listen(handler?: Handler) {
  const server = createApiServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(() => {
  vi.stubEnv("RELAY_MODE", "server");
  vi.stubEnv("API_ORIGIN", "https://api.example.com");
  vi.stubEnv("FRONTEND_ORIGINS", origin);
  vi.stubEnv("ACCESS_PASSWORD", "test-private-password");
  vi.stubEnv("AUTH_SECRET", "a".repeat(64));
  records = [];
  vi.spyOn(console, "info").mockImplementation((value) => records.push(String(value)));
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("plain Node API", () => {
  it("handles actual HTTP preflight with exact origin", async () => {
    const base = await listen();
    const response = await fetch(`${base}/api/video`, { method: "OPTIONS", headers: {
      Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type",
    } });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
  it("denies foreign origins", async () => {
    const base = await listen();
    const response = await fetch(`${base}/api/backend`, { headers: { Origin: "https://evil.example.com" } });
    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });
  it("requires bearer auth and accepts valid sessions", async () => {
    const base = await listen();
    expect((await fetch(`${base}/api/backend`, { headers: { Origin: origin } })).status).toBe(401);
    const token = sealToken("session", createSession());
    const response = await fetch(`${base}/api/backend`, { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
    expect(await response.json()).toEqual({ connected: true, mode: "vps" });
  });
  it("logs in using streaming JSON without issuing cross-site cookies", async () => {
    const base = await listen();
    const response = await fetch(`${base}/api/auth`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-private-password" }) });
    expect(response.status).toBe(200);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect((await response.json()).token).toBeTruthy();
    expect(records.join(" ")).not.toContain("test-private-password");
  });
  it("rejects oversized request bodies", async () => {
    const base = await listen();
    const response = await fetch(`${base}/api/auth`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password: "x".repeat(5000) }) });
    expect(response.status).toBe(413);
  });
  it("returns safe 404/405 and blocks prototype routes", async () => {
    for (const path of ["/missing", "/toString", "/__proto__"]) {
      const result = await dispatch(new Request(`https://api.example.com${path}`, { headers: { Origin: origin } }));
      expect(result.status).toBe(404);
    }
    const result = await dispatch(new Request("https://api.example.com/api/video", { headers: { Origin: origin } }));
    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toContain("POST");
  });
  it("suppresses HEAD body and streams byte responses", async () => {
    const base = await listen(() => new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { "Content-Range": "bytes 0-2/3", "Content-Length": "3" } }));
    const head = await fetch(base, { method: "HEAD" });
    expect(head.status).toBe(206);
    expect(await head.text()).toBe("");
    const get = await fetch(base);
    expect([...new Uint8Array(await get.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(get.headers.get("content-range")).toBe("bytes 0-2/3");
  });
  it("correlates stage/error logs and redacts query, auth, cookies and body", async () => {
    const base = await listen(async () => {
      logEvent("youtube.resolve", { stage: "metadata" });
      return new Response("{}", { status: 422, headers: { "X-Relay-Error": "UPSTREAM_BLOCKED" } });
    });
    const response = await fetch(`${base}/api/video?ticket=SECRET-TICKET`, { method: "POST", headers: { Authorization: "Bearer SECRET-TOKEN", Cookie: "SECRET-COOKIE" }, body: "SECRET-BODY" });
    await response.text();
    const logs = records.map((record) => JSON.parse(record));
    const id = response.headers.get("x-request-id");
    expect(logs.find((log) => log.event === "youtube.resolve").requestId).toBe(id);
    const end = logs.find((log) => log.event === "request.end");
    expect(end).toMatchObject({ requestId: id, status: 422, code: "UPSTREAM_BLOCKED", complete: true });
    expect(end.durationMs).toBeGreaterThanOrEqual(0);
    expect(records.join(" ")).not.toContain("SECRET-");
  });
  it("aborts upstream work when the client disconnects", async () => {
    let aborted = false;
    const base = await listen((request) => {
      request.signal.addEventListener("abort", () => { aborted = true; });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } }));
    });
    const controller = new AbortController();
    const response = await fetch(base, { signal: controller.signal });
    await response.body!.getReader().read();
    controller.abort();
    await vi.waitFor(() => expect(aborted).toBe(true));
  });
});
