import { defineConfig, devices } from "@playwright/test";
const key = "e2e-home-shared-key-at-least-32-characters-not-for-deployment";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "live.spec.ts",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3102", trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101", reuseExistingServer: false,
      env: { RELAY_MODE: "home", RELAY_DEV_DIST_DIR: ".next/e2e-home", ACCESS_PASSWORD: "unused-home-password", AUTH_SECRET: "home-e2e-auth-secret-at-least-32-characters", HOME_BACKEND_KEY: key },
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3102",
      url: "http://127.0.0.1:3102", reuseExistingServer: false,
      env: { RELAY_MODE: "frontend", RELAY_DEV_DIST_DIR: ".next/e2e-frontend", ACCESS_PASSWORD: "abc", AUTH_SECRET: "frontend-e2e-auth-secret-at-least-32-characters", HOME_BACKEND_KEY: key, HOME_BACKEND_URL: "http://127.0.0.1:3101" },
    },
  ],
});
