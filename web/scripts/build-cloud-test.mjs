import { spawnSync } from "node:child_process";
// Public test configuration only. Every Supabase request is intercepted in Playwright.
const result = spawnSync(
  "npm",
  ["run", "build", "--", "--outDir", "dist-cloud"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DATA_MODE: "supabase",
      VITE_SUPABASE_URL: "https://nba-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only",
    },
  },
);
process.exit(result.status ?? 1);
