import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./tests",
  testMatch: "cloud.spec.js",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
  },
  webServer: {
    command:
      "node scripts/build-cloud-test.mjs && npm exec vite preview -- --host 127.0.0.1 --port 4174 --outDir dist-cloud",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: "list",
});
