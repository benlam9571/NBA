import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dataConfig } from "./src/cloudConfig.js";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  for (const name of [
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_SECRET_KEY",
    "VITE_ODDS_API_KEY",
  ])
    if (env[name])
      throw Error(
        `Remove ${name}: secret credentials must never be bundled into the browser.`,
      );
  const cloud = Boolean(env.VERCEL) || dataConfig(env).mode === "supabase";
  if (cloud) dataConfig({ ...env, VITE_DATA_MODE: "supabase" }); // fail before a broken or unsafe deployment
  return {
    plugins: [react()],
    publicDir: cloud ? false : "../data",
    define: cloud
      ? { "import.meta.env.VITE_DATA_MODE": JSON.stringify("supabase") }
      : undefined,
  };
});
