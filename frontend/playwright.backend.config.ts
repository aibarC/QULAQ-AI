import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/backend-http.spec.ts",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: "./test-results/backend-http",
  metadata: { backendFixture: true },
  use: {
    viewport: { width: 1440, height: 1000 },
    browserName: "chromium",
    launchOptions: {
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: [
    { name: "enabled-fixture", use: { baseURL: "http://127.0.0.1:5175" } },
    { name: "disabled-fixture", use: { baseURL: "http://127.0.0.1:5176" } },
  ],
  webServer: [
    {
      command: "node --import tsx ../backend/tests/browser-fixture.ts",
      url: "http://127.0.0.1:8001/api/workspace",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    ...[5175, 5176].map((port, index) => ({
      command: `npm run dev -- --port ${port} --strictPort`,
      env: {
        VITE_API_BASE_URL: "/api",
        QULAQ_API_TARGET: `http://127.0.0.1:${8001 + index}`,
      },
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 30_000,
    })),
  ],
});
