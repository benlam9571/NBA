import { test, expect } from "@playwright/test";
function fixture() {
  const now = Date.now(),
    fetched_at = new Date(now - 60000).toISOString(),
    commence_time = new Date(now + 6 * 3600000).toISOString();
  const q = {
    fetched_at,
    updated_at: fetched_at,
    commence_time,
    event_id: "test-event",
    game_id: "test-espn",
    home: "Los Angeles Lakers",
    away: "Detroit Pistons",
    pid: "3945274",
    player_name: "Luka Doncic",
    market: "player_points",
    stat: "pts",
    line: 35.5,
    analysis_line: 35.5,
    over_price: 2.2,
    under_price: 1.8,
    eligible: true,
    bookmaker: "sportsbet",
    bookmaker_title: "Sportsbet",
  };
  return {
    schema_version: 1,
    status: "connected",
    is_fixture: true,
    fetched_at,
    rows: [
      q,
      {
        ...q,
        bookmaker: "tab",
        bookmaker_title: "TAB",
        over_price: 2.4,
        under_price: 1.65,
      },
    ],
    history: [
      {
        ...q,
        fetched_at: new Date(now - 3600000).toISOString(),
        line: 34.5,
        analysis_line: 34.5,
      },
    ],
    issues: [],
  };
}
test("EV ranking, weights and exact line deep link with clearly marked test data", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/odds.json", (route) =>
    route.fulfill({ json: fixture() }),
  );
  await page.goto("/#odds");
  await expect(
    page.getByRole("heading", { name: "今晚 EV 排行", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("測試快照 · 非真實盤口")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Luka Doncic" });
  await expect(row).toHaveCount(1);
  await expect(
    row.getByRole("cell", { name: "TAB", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("cell", { name: "2.40", exact: true }),
  ).toBeVisible();
  await page.getByText("估計勝率權重設定", { exact: true }).click();
  await page.getByLabel("近 10 場權重").fill("0");
  await page.getByLabel("今季權重").fill("0");
  await page.getByLabel("上季權重").fill("0");
  await expect(
    page.getByRole("button", { name: "套用權重", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("近 10 場權重").fill("1");
  await page.getByRole("button", { name: "套用權重", exact: true }).click();
  await row.click();
  await expect(page).toHaveURL(/#player\/3945274\/pts\/35.5$/);
  await expect(
    page.getByRole("spinbutton", { name: "盤口", exact: true }),
  ).toHaveValue("35.5");
  await expect(page.getByRole("heading", { name: /^盤口分析/ })).toBeVisible();
  await page.getByText("盤口變動紀錄（3 筆）", { exact: true }).click();
  await expect(page.getByRole("img", { name: "歷史盤口變動圖" })).toBeVisible();
  await page.getByLabel("分析項目").selectOption("reb");
  await expect(
    page.getByRole("spinbutton", { name: "盤口", exact: true }),
  ).not.toHaveValue("35.5");
  await expect(page.getByText("呢位球員／項目暫無可用盤口。")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("分析項目")).toHaveValue("pts"); // stat is transient; odds route params cleared by manual stat selection
  await page.goto("/#team/LAL");
  await expect(
    page.getByRole("button").filter({ hasText: "Luka Doncic" }),
  ).toContainText("Sportsbet 35.5");
  expect(errors).toEqual([]);
});
test("400px leaderboard and bookmaker comparison have no page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 850 });
  await page.route("**/odds.json", (route) =>
    route.fulfill({ json: fixture() }),
  );
  await page.goto("/#odds");
  await expect(
    page.getByRole("cell", { name: "Luka Doncic", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("cell", { name: "Luka Doncic", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "盤口", exact: true }),
  ).toHaveValue("35.5");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("corrupt snapshot explains the error and keeps first-phase analysis usable", async ({
  page,
}) => {
  await page.route("**/odds.json", (route) =>
    route.fulfill({ json: { schema_version: 999, rows: [] } }),
  );
  await page.goto("/#odds");
  await expect(page.getByText("讀取失敗", { exact: true })).toBeVisible();
  await expect(
    page.getByText("盤口快照格式有誤", { exact: false }),
  ).toBeVisible();
  await page.goto("/#player/3945274");
  await expect(
    page.getByRole("heading", { name: "Luka Doncic", exact: true }),
  ).toBeVisible();
});
