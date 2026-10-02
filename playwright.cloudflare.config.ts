import { defineConfig, devices } from "@playwright/test";
import { workerTest } from "./scripts/worker-test-settings.mjs";

export default defineConfig({
  testDir: "./e2e", testMatch: "cloudflare.spec.ts",
  fullyParallel: false, workers: 1,
  use: { baseURL: workerTest.frontendOrigin, trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "node scripts/start-worker-test.mjs", url: workerTest.apiOrigin, reuseExistingServer: false },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3103",
      url: workerTest.frontendOrigin, reuseExistingServer: false,
      env: { RELAY_MODE: "cloudflare", RELAY_DEV_DIST_DIR: ".next/e2e-cloudflare", NEXT_PUBLIC_API_ORIGIN: workerTest.apiOrigin, ACCESS_PASSWORD: "", AUTH_SECRET: "" },
    },
  ],
});
