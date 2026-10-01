import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Regression: a three-character password must not disable the gate.
const password = "abc";
async function unlock(page: Page) {
  await page.getByLabel("Mật khẩu truy cập", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Mở khóa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hôm nay, xem gì?" })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("private gate, wrong password, unlock and responsive workspace", async ({ page }, testInfo) => {
  const outbound: string[] = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== "http://127.0.0.1:3100") outbound.push(request.url()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vào không gian riêng" })).toBeVisible();
  await noOverflow(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/gate-${testInfo.project.name}.png`, fullPage: true });
  await page.getByLabel("Mật khẩu truy cập", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Mở khóa", exact: true }).click();
  await expect(page.locator("#auth-error")).toContainText("Mật khẩu chưa đúng");
  await unlock(page);
  await expect(page.getByLabel("LINK YOUTUBE", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chưa có video nào." })).toBeVisible();
  await noOverflow(page);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/workspace-${testInfo.project.name}.png`, fullPage: true });
  expect(outbound).toEqual([]);
});

test("invalid links and explicit upstream failures do not pretend to play", async ({ page }) => {
  await page.goto("/");
  await unlock(page);
  let calls = 0;
  await page.route("**/api/video", async (route) => {
    calls++;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "UPSTREAM_BLOCKED", message: "YouTube từ chối luồng từ IP server. Vercel-only có thể không phát được video này." } }) });
  });
  await page.getByLabel("LINK YOUTUBE", { exact: true }).fill("https://evil.test/anything");
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect(page.locator(".error-notice[role=alert]")).toContainText("Chỉ hỗ trợ link từ YouTube");
  expect(calls).toBe(0);
  await page.getByLabel("LINK YOUTUBE", { exact: true }).fill("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect(page.locator(".error-notice[role=alert]")).toContainText("YouTube từ chối luồng");
  await expect(page.getByText("Chưa phát được", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  expect(await page.locator("video").count()).toBe(0);
  await page.getByRole("radio", { name: "Chỉ nghe" }).check();
  await expect(page.getByRole("heading", { name: "Hôm nay, nghe gì?" })).toBeVisible();
  await expect(page.getByLabel("Chất lượng", { exact: true })).toBeDisabled();
  await noOverflow(page);
});

test("local history sanitization, clear and locking", async ({ page, request }) => {
  expect((await request.get("/api/stream?url=https://evil.test")).status()).toBe(401);
  await page.addInitScript(() => {
    localStorage.setItem("relay:history:v1", JSON.stringify([{ id: "jNQXAC9IVRw", title: "Me at the zoo", author: "jawed", duration: 19, playedAt: 123, thumbnail: "https://evil.test/tracker.jpg" }]));
  });
  await page.route("**/api/thumbnail**", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await unlock(page);
  await expect(page.getByRole("button", { name: "Phát lại Me at the zoo" })).toBeVisible();
  expect(await page.locator(".history-thumbnail img").getAttribute("src")).toBe("/api/thumbnail?id=jNQXAC9IVRw");
  await page.getByRole("button", { name: "Xóa lịch sử" }).click();
  await expect(page.getByRole("heading", { name: "Chưa có video nào." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("relay:history:v1"))).toBe("[]");
  await page.getByRole("button", { name: "Khóa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vào không gian riêng" })).toBeVisible();
  expect((await page.request.get("/api/auth")).status()).toBe(200);
  expect(await (await page.request.get("/api/auth")).json()).toEqual({ authenticated: false });
});
