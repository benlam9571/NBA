import { test, expect } from "@playwright/test";
test("search, navigation, line controls, reload and both themes", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "全部球隊", exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜尋球員或球隊").fill("Luka");
  await page.getByRole("cell", { name: "Luka Doncic", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Luka Doncic", exact: true }),
  ).toBeVisible();
  const line = page.getByRole("spinbutton", { name: "盤口", exact: true });
  await line.fill("30");
  await expect(line).toHaveValue("30.5");
  await page.getByLabel("分析項目").selectOption("reb");
  await expect(line).not.toHaveValue("30.5");
  await page.getByLabel("球員", { exact: true }).selectOption("1966");
  await expect(
    page.getByRole("heading", { name: "LeBron James", exact: true }),
  ).toBeVisible();
  await page.getByLabel("分析項目").selectOption("pts");
  await page.getByLabel("盤口拉桿").focus();
  for (let i = 0; i < 40; i++)
    await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight");
  await expect(line).toHaveValue(
    await page.getByLabel("盤口拉桿").inputValue(),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "LeBron James", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "切換深淡色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切換深淡色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/#team/LAL");
  await expect(
    page.getByRole("heading", { name: "Los Angeles Lakers", exact: true }),
  ).toBeVisible();
  await page.getByRole("button").filter({ hasText: "Luka Doncic" }).click();
  await expect(page).toHaveURL(/#player\/3945274/);
  await page.getByLabel("圖表場數").selectOption("40");
  await page.getByLabel("防守位置").selectOption("G");
  expect(errors).toEqual([]);
});
test("400px screens keep content within viewport across all three layers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 850 });
  for (const hash of ["#teams", "#team/LAL", "#player/3945274"]) {
    await page.goto("/" + hash);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
