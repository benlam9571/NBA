import { test, expect } from "@playwright/test";
import { readFile, access } from "node:fs/promises";
const UID = "11111111-1111-4111-8111-111111111111";
const snapshotPath = "versions/" + "a".repeat(64) + "/snapshot.json",
  oddsPath = "versions/" + "b".repeat(64) + "/odds.json";
async function setup(
  page,
  { allowed = true, invalidManifest = false, badPassword = false } = {},
) {
  const downloads = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const token =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({
      sub: UID,
      aud: "authenticated",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }) +
    ".test-signature";
  const user = {
    id: UID,
    aud: "authenticated",
    role: "authenticated",
    email: "owner@example.test",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const manifest = {
    schema_version: 1,
    published_at: new Date().toISOString(),
    snapshot: snapshotPath,
    odds: oddsPath,
  };
  const data = JSON.parse(
    await readFile(
      new URL("../../data/snapshot.json", import.meta.url),
      "utf8",
    ),
  );
  await page.route("https://nba-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      headers = {
        "access-control-allow-origin": "http://127.0.0.1:4174",
        "access-control-allow-headers":
          "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      };
    if (req.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith("/token"))
      return route.fulfill({
        status: badPassword ? 400 : 200,
        headers,
        json: badPassword
          ? { code: "invalid_credentials", msg: "Invalid login credentials" }
          : {
              access_token: token,
              refresh_token: "test-refresh-only",
              token_type: "bearer",
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user,
            },
      });
    if (url.pathname.endsWith("/user"))
      return route.fulfill({ headers, json: user });
    if (url.pathname.endsWith("/logout"))
      return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith("/nba_app_members"))
      return route.fulfill({
        headers,
        json: allowed ? [{ user_id: UID }] : [],
      });
    if (url.pathname.includes("/storage/v1/object/")) {
      downloads.push(url.pathname);
      if (url.pathname.endsWith("/latest.json"))
        return route.fulfill({
          headers,
          json: invalidManifest
            ? { ...manifest, snapshot: "../secret" }
            : manifest,
        });
      if (url.pathname.endsWith("/" + snapshotPath))
        return route.fulfill({ headers, json: data });
      if (url.pathname.endsWith("/" + oddsPath))
        return route.fulfill({
          headers,
          json: {
            schema_version: 1,
            status: "disconnected",
            rows: [],
            history: [],
            issues: [],
          },
        });
    }
    return route.fulfill({
      status: 404,
      headers,
      json: { message: "Unexpected test route" },
    });
  });
  return { downloads, errors };
}
async function login(page) {
  await page.getByLabel("登入電郵").fill("owner@example.test");
  await page.getByLabel("登入密碼").fill("test-password-only");
  await page.getByRole("button", { name: "登入", exact: true }).click();
}
test("cloud build never includes local snapshots; anonymous users see login only", async ({
  page,
}) => {
  const ctx = await setup(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "登入你的分析空間" }),
  ).toBeVisible();
  expect(ctx.downloads).toEqual([]);
  for (const name of ["snapshot.json", "odds.json", "nba_gamelogs.csv"])
    await expect(
      access(new URL("../dist-cloud/" + name, import.meta.url)),
    ).rejects.toThrow();
  expect(ctx.errors).toEqual([]);
});
test("allowed account reads a pinned manifest, reloads and signs out", async ({
  page,
}) => {
  const ctx = await setup(page);
  await page.goto("/#player/3945274");
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Luka Doncic", exact: true }),
  ).toBeVisible();
  expect(ctx.downloads.length).toBe(3);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Luka Doncic", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "登入你的分析空間" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Luka Doncic", exact: true }),
  ).toHaveCount(0);
  expect(ctx.errors).toEqual([]);
});
test("non-member account cannot initiate snapshot downloads", async ({
  page,
}) => {
  const ctx = await setup(page, { allowed: false });
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("heading", { name: "尚未獲授權" })).toBeVisible();
  expect(ctx.downloads).toEqual([]);
  expect(ctx.errors).toEqual([]);
});
test("failed credentials and 400px login remain usable", async ({ page }) => {
  await setup(page, { badPassword: true });
  await page.setViewportSize({ width: 400, height: 850 });
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("alert")).toContainText("登入失敗");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("invalid manifest is rejected before downloading any snapshots", async ({
  page,
}) => {
  const ctx = await setup(page, { invalidManifest: true });
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText("雲端資料路徑格式有誤。", { exact: true }),
  ).toBeVisible();
  expect(ctx.downloads.length).toBe(1);
});
