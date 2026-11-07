import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/api-dataset.spec.ts",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: "list",
  outputDir: "./test-results/api-contract",
  metadata: { apiFixture: true },
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    browserName: "chromium",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    env: { VITE_API_BASE_URL: "/api" },
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
