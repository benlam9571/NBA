export function publicKeyAllowed(key) {
  if (typeof key !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    const payload = JSON.parse(
      atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return key.split(".").length === 3 && payload.role === "anon";
  } catch {
    return false;
  }
}
export function dataConfig(env = {}) {
  const mode =
    env.VITE_DATA_MODE ||
    (env.VITE_SUPABASE_URL || env.VITE_SUPABASE_PUBLISHABLE_KEY
      ? "supabase"
      : "local");
  if (!["local", "supabase"].includes(mode))
    throw Error("VITE_DATA_MODE 必須為 local 或 supabase。");
  if (mode === "local") return { mode };
  const url = env.VITE_SUPABASE_URL,
    key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  try {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !["", "/"].includes(u.pathname)
    )
      throw Error();
  } catch {
    throw Error("請設定有效的 VITE_SUPABASE_URL（HTTPS 專案網址）。");
  }
  if (!publicKeyAllowed(key))
    throw Error(
      "請設定 Supabase publishable key 或舊版 anon key；前端禁止使用 secret／service-role key。",
    );
  return {
    mode,
    url: url.replace(/\/$/, ""),
    key,
    bucket: "nba-props-private",
  };
}
export function validateManifest(manifest) {
  if (
    manifest?.schema_version !== 1 ||
    !Number.isFinite(Date.parse(manifest.published_at))
  )
    throw Error("雲端資料版本格式有誤。");
  for (const kind of ["snapshot", "odds"])
    if (
      typeof manifest[kind] !== "string" ||
      !new RegExp("^versions/[a-f0-9]{64}/" + kind + "\\.json$").test(
        manifest[kind],
      )
    )
      throw Error("雲端資料路徑格式有誤。");
  return manifest;
}
