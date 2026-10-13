import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
  },
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: true,
    timeout: 30000,
  },
  reporter: "list",
  outputDir: "output/performance-tests",
});
