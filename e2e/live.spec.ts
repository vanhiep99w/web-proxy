import { expect, test } from "@playwright/test";

// Optional: real YouTube availability depends on network and server egress IP.
test("real upstream playback and seeking", async ({ page }) => {
  test.skip(process.env.RUN_LIVE_SMOKE !== "1", "Opt in with RUN_LIVE_SMOKE=1; upstream-dependent.");
  test.setTimeout(120000);
  const failures: string[] = [];
  const relayedStreams: number[] = [];
  page.on("request", (request) => {
    if (request.resourceType() !== "document") expect(new URL(request.url()).hostname).not.toMatch(/(?:youtube|googlevideo|ytimg)\./);
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/stream" && response.headers()["x-relay-backend"] === "home") relayedStreams.push(response.status());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/");
  await page.getByLabel("Mật khẩu truy cập", { exact: true }).fill("abc");
  await page.getByRole("button", { name: "Mở khóa", exact: true }).click();
  if (process.env.RUN_HOME_SMOKE === "1") {
    await page.getByRole("button", { name: "Kiểm tra backend nhà" }).click();
    await expect(page.getByText("Kết nối backend nhà thành công. Khả năng phát còn phụ thuộc YouTube.")).toBeVisible();
  }
  await page.getByLabel("LINK YOUTUBE", { exact: true }).fill("jNQXAC9IVRw");
  await page.getByRole("button", { name: "Phát", exact: true }).click();
  await expect.poll(async () => (await page.locator("video").count()) > 0 || (await page.locator(".error-notice").count()) > 0, { timeout: 90000 }).toBe(true);
  expect(await page.locator(".error-notice").allTextContents(), "Upstream must return an actually usable stream").toEqual([]);
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 30000 }).toBeGreaterThan(2);
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 10; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 30000 }).toBeGreaterThan(11);
  await expect(page.getByRole("button", { name: "Phát lại Me at the zoo" })).toBeVisible();
  await page.getByRole("radio", { name: "Chỉ nghe" }).check();
  await expect(page.locator(".audio-container video")).toBeVisible({ timeout: 60000 });
  await expect.poll(() => page.locator("video").evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 30000 }).toBeGreaterThan(12);
  await expect(page.getByText("Chỉ âm thanh", { exact: true })).toBeVisible();
  await page.locator("video").evaluate((element: HTMLVideoElement) => element.pause());
  await expect(page.getByText("Đã tạm dừng", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
  if (process.env.RUN_HOME_SMOKE === "1") {
    expect(relayedStreams.length).toBeGreaterThan(0);
    expect(relayedStreams.every((status) => status === 206)).toBe(true);
  }
});
