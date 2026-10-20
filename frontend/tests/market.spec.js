import { test, expect } from "@playwright/test";
const groupForMenuItem = {
  "资产总览": "资产管理",
  "我的持仓": "资产管理",
  "持仓诊断": "研究分析",
  "股票研究": "研究分析",
  "模拟交易": "交易与风控",
  "风控中心": "交易与风控",
  "导入与设置": "系统设置",
};
async function clickNav(page, name) {
  const nav = page.getByRole("navigation", { name: "功能导航" });
  const group = nav.getByRole("button", { name: groupForMenuItem[name], exact: true });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await nav.getByRole("button", { name }).click();
}


test.beforeEach(async ({ request }) => {
  await request.put("/api/market-data/settings", {
    data: {
      mode: "real",
      twelve_personal_use: false,
      akshare_personal_use: false,
    },
  });
});
test.afterEach(async ({ request }) => {
  await request.put("/api/market-data/settings", { data: { mode: "demo" } });
});

test("real mode never substitutes demo prices or FX and shows Apple-style connection state", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "资产走势", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("真实日线模式：")).toBeVisible();
  const result = await (await request.get("/api/positions")).json();
  expect(result.combined.equity).toBeNull();
  expect(result.fx).toBeNull();
  expect(result.positions.every((p) => p.price === null && !p.demo)).toBe(true);
  await expect(
    page.getByText("无法计算完整持仓分布", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "选择资产估值日期" }),
  ).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/apple-real-pending.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "行情连接与许可" }).click();
  await expect(
    page.getByRole("heading", { name: "行情连接", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("上游个人使用授权尚未核实", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "更新真实行情", exact: true })
    .last()
    .click();
  await expect(page.getByRole("status")).toContainText("实际结果");
  const after = await (await request.get("/api/positions")).json();
  expect(after.positions.every((p) => p.price === null)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/screenshots/apple-source-mobile.png",
    fullPage: true,
  });
});

test("mode switch is explicit, upstream rights cannot be replaced by MIT and no paid subscription", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await clickNav(page, "导入与设置");
  await page.getByRole("combobox", { name: "行情模式" }).selectOption("demo");
  await page.getByRole("button", { name: "保存行情设置" }).click();
  await expect(page.getByRole("status")).toContainText("未开通任何付费服务");
  await expect(
    page.getByText("全部行情、汇率和初始资产均为虚构样例"),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "行情模式" }).selectOption("real");
  await page.getByRole("button", { name: "保存行情设置" }).click();
  await expect(page.getByRole("status")).toContainText("未开通任何付费服务");
  await expect(page.getByText("真实日线模式：")).toBeVisible();
  const response = await request.put("/api/market-data/settings", {
    data: {
      mode: "real",
      akshare_personal_use: true,
      akshare_license_reference:
        "https://github.com/akfamily/akshare/blob/main/LICENSE",
    },
  });
  expect(response.status()).toBe(422);
  const status = await (await request.get("/api/market-data/status")).json();
  expect(status.akshare_personal_use).toBe(false);
  expect(status.auto_subscribe).toBe(false);
});
