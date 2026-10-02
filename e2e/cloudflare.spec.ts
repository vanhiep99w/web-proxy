import { expect, test, type Page } from "@playwright/test";
import { workerTest } from "../scripts/worker-test-settings.mjs";
import { parseSession } from "../lib/auth";
import { mintMediaTicket } from "../lib/media";

async function unlock(page: Page): Promise<string> {
  await page.getByLabel("Mật khẩu truy cập", { exact: true }).fill(workerTest.password);
  const response = page.waitForResponse((response) => response.url() === workerTest.apiOrigin + "/api/auth" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Mở khóa", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const body = await result.json();
  expect(result.headers()["set-cookie"]).toBeUndefined();
  await expect(page.getByRole("heading", { name: "Hôm nay, xem gì?" })).toBeVisible();
  return body.token;
}

test("direct Worker login, CORS, history thumbnails, reload and offline locking", async ({ page, context }) => {
  const frontendApi: string[] = [];
  const forbidden: string[] = [];
  const thumbnailAuth: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === workerTest.frontendOrigin && url.pathname.startsWith("/api/")) frontendApi.push(request.url());
    if (/(?:youtube|googlevideo|ytimg)\./.test(url.hostname)) forbidden.push(request.url());
    if (url.origin === workerTest.apiOrigin && url.pathname === "/api/thumbnail" && request.method() === "GET") thumbnailAuth.push(request.headers()["authorization"]);
  });
  await page.addInitScript(() => localStorage.setItem("relay:history:v1", JSON.stringify([{ id: "jNQXAC9IVRw", title: "Me at the zoo", author: "jawed", duration: 19, playedAt: 123, thumbnail: "https://evil.test/tracker.jpg" }])));
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain(workerTest.apiOrigin);
  const token = await unlock(page);
  await expect(page.getByRole("button", { name: "Phát lại Me at the zoo" })).toBeVisible();
  await expect(page.locator(".history-thumbnail img")).toHaveAttribute("src", /^blob:/);
  expect(thumbnailAuth).toContain("Bearer " + token);
  await page.getByRole("button", { name: "Kiểm tra backend Cloudflare" }).click();
  await expect(page.getByText("Kết nối backend Cloudflare thành công. Khả năng phát còn phụ thuộc YouTube.")).toBeVisible();
  const storage = await context.storageState();
  expect(storage.cookies).toEqual([]);
  expect(JSON.stringify(storage)).not.toContain(token);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Khóa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vào không gian riêng" })).toBeVisible();
  await context.setOffline(false);
  await unlock(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Vào không gian riêng" })).toBeVisible();
  expect(frontendApi).toEqual([]); expect(forbidden).toEqual([]); expect(errors).toEqual([]);
  // Vercel cannot accidentally remain an authenticated media proxy.
  expect((await page.request.get("/api/stream")).status()).toBe(404);
});

test("DASH sends session Authorization and byte ranges directly to the Worker", async ({ page }) => {
  await page.goto("/");
  const token = await unlock(page);
  process.env.ACCESS_PASSWORD = workerTest.password; process.env.AUTH_SECRET = workerTest.secret;
  const session = parseSession(token)!;
  expect(session).not.toBeNull();
  const ticket = mintMediaTicket({ url: "https://rr1.googlevideo.com/videoplayback?itag=140", total: 100, mime: 'audio/mp4; codecs="mp4a.40.2"', sid: session.sid, exp: session.exp });
  const mediaUrl = workerTest.apiOrigin + "/api/stream?ticket=" + ticket;
  let resolverAuthorization = "";
  await page.route(workerTest.apiOrigin + "/api/video", async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    resolverAuthorization = route.request().headers()["authorization"];
    // Deliberately non-playable offline bytes: this tests transport, not YouTube availability.
    const manifest = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" minBufferTime="PT0.5S" mediaPresentationDuration="PT1S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"><Period duration="PT1S"><AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2"><Representation id="140" bandwidth="128000" audioSamplingRate="44100"><BaseURL>${mediaUrl}</BaseURL><SegmentBase indexRange="10-99" indexRangeExact="true"><Initialization range="0-9"/></SegmentBase></Representation></AdaptationSet></Period></MPD>`;
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": workerTest.frontendOrigin }, body: JSON.stringify({ id: "jNQXAC9IVRw", title: "Offline transport fixture", author: "Tests", duration: 1, thumbnail: "/api/thumbnail?id=jNQXAC9IVRw", manifest, mode: "audio", quality: "Chỉ âm thanh", expiresAt: session.exp }) });
  });
  const request = page.waitForRequest((request) => request.url().startsWith(workerTest.apiOrigin + "/api/stream") && request.method() === "GET");
  const response = page.waitForResponse((response) => response.url().startsWith(workerTest.apiOrigin + "/api/stream") && response.request().method() === "GET");
  await page.getByRole("radio", { name: "Chỉ nghe" }).check();
  await page.getByLabel("LINK YOUTUBE", { exact: true }).fill("jNQXAC9IVRw");
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  const stream = await request;
  expect(resolverAuthorization).toBe("Bearer " + token);
  expect(stream.headers()["authorization"]).toBe("Bearer " + token);
  expect(stream.headers()["cookie"]).toBeUndefined();
  expect(stream.headers()["range"]).toMatch(/^bytes=/);
  expect(stream.url()).not.toContain(token);
  expect((await response).status()).toBe(206);
  await page.getByRole("button", { name: "Khóa", exact: true }).click();
  await expect(page.locator("video")).toHaveCount(0);
});
