import test from "node:test";
import assert from "node:assert/strict";
import {
  dataConfig,
  publicKeyAllowed,
  validateManifest,
} from "./cloudConfig.js";
const jwt = (role) =>
  ["eyJhbGciOiJIUzI1NiJ9", btoa(JSON.stringify({ role })), "signature"].join(
    ".",
  );
const good = {
  VITE_DATA_MODE: "supabase",
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
};
test("local development requires no Supabase project", () =>
  assert.deepEqual(dataConfig(), { mode: "local" }));
test("cloud config permits only public keys and HTTPS origins", () => {
  assert.equal(dataConfig(good).mode, "supabase");
  assert.equal(publicKeyAllowed("sb_publishable_public-example"), true);
  for (const key of [jwt("service_role"), "sb_secret_123", "garbage", ""])
    assert.throws(() =>
      dataConfig({ ...good, VITE_SUPABASE_PUBLISHABLE_KEY: key }),
    );
  for (const url of [
    "http://example.supabase.co",
    "https://user:pass@example.supabase.co",
    "https://example.supabase.co/path",
    "https://example.supabase.co?x=1",
  ])
    assert.throws(() => dataConfig({ ...good, VITE_SUPABASE_URL: url }));
  assert.throws(() => dataConfig({ VITE_DATA_MODE: "supabase" }));
});
test("manifest cannot redirect downloads outside immutable snapshot paths", () => {
  const manifest = {
    schema_version: 1,
    published_at: "2026-11-10T00:00:00Z",
    snapshot: "versions/" + "a".repeat(64) + "/snapshot.json",
    odds: "versions/" + "b".repeat(64) + "/odds.json",
  };
  assert.equal(validateManifest(manifest), manifest);
  for (const path of [
    "https://evil.example/data",
    "../secret",
    "latest.json",
    "versions/123/snapshot.json",
  ])
    assert.throws(() => validateManifest({ ...manifest, snapshot: path }));
  assert.throws(() => validateManifest({ ...manifest, published_at: "bad" }));
});
