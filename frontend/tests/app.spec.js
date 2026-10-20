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

const offline = process.env.STOCKPILOT_OFFLINE_TEST === "1";
const hostedDemo = process.env.STOCKPILOT_HOSTED_DEMO_TEST === "1";
const start = offline
  ? "http://127.0.0.1:8012/StockPilot-%E6%BC%94%E7%A4%BA%E4%BD%93%E9%AA%8C.html"
  : "/";

test("navigation: four collapsible groups work on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(start);
  const nav = page.getByRole("navigation", { name: "功能导航" });
  const assets = nav.getByRole("button", { name: "资产管理", exact: true });
  const research = nav.getByRole("button", { name: "研究分析", exact: true });
  await expect(assets).toHaveAttribute("aria-expanded", "true");
  await expect(research).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("button", { name: "我的持仓" })).toBeVisible();
  await research.click();
  await expect(research).toHaveAttribute("aria-expanded", "true");
  await expect(assets).toHaveAttribute("aria-expanded", "false");
  await clickNav(page, "股票研究");
  await expect(page.getByRole("heading", { name: "股票研究", exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await clickNav(page, "模拟交易");
  await expect(page.getByRole("heading", { name: "模拟交易", exact: true }).first()).toBeVisible();
  await expect(nav.getByRole("button", { name: "交易与风控", exact: true })).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("desktop: dashboard, diagnostics, research, rules and import", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(start);
  await expect(page.getByRole("heading", { name: "当前持仓" })).toBeVisible();
  await expect(
    page.getByText("全部行情、汇率和初始资产均为虚构样例"),
  ).toBeVisible();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(7);
  await page.screenshot({
    path: "../docs/screenshots/dashboard.png",
    fullPage: true,
  });
  await clickNav(page, "我的持仓");
  await page.getByRole("textbox", { name: "搜索持仓" }).fill("茅台");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await page.getByRole("button", { name: "分析贵州茅台" }).click();
  await expect(
    page.getByRole("heading", { name: "亏损情景对比" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "逐步减仓", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成报告" }).click();
  await expect(page.getByRole("button", { name: "下载 JSON" })).toBeVisible();
  await clickNav(page, "股票研究");
  await page.getByRole("textbox", { name: "搜索股票" }).fill("NVDA");
  await page.getByRole("button", { name: "英伟达 NVDA" }).click();
  await expect(
    page.getByRole("heading", { name: "英伟达 · 历史样例" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消收藏英伟达" }).click();
  await expect(
    page.getByRole("button", { name: "添加收藏英伟达" }),
  ).toBeVisible();
  await clickNav(page, "风控中心");
  await page.getByRole("spinbutton", { name: "单股仓位上限 (%)" }).fill("20");
  await page.getByRole("button", { name: "保存风险规则" }).click();
  await expect(page.getByRole("status")).toContainText("风控规则已保存");
  await clickNav(page, "导入与设置");
  await page.getByRole("button", { name: "校验并预览" }).click();
  await expect(page.getByText("预览：可接受 1 行")).toBeVisible();
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("处理结果：可接受 1 行")).toBeVisible();
  await page.getByRole("button", { name: "校验并预览" }).click();
  await expect(page.getByText("预览：可接受 0 行 · 重复 1 行")).toBeVisible();
  expect(errors).toEqual([]);
});

test("paper: manual demo consent, buy/sell, realized P&L, cancel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(start);
  await clickNav(page, "模拟交易");
  await expect(
    page.getByRole("heading", { name: "创建模拟交易计划" }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "创建模拟订单" }).click();
  await page.getByRole("button", { name: "模拟成交", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("模拟成交已写入账本");
  await page.getByRole("combobox", { name: "模拟方向" }).selectOption("sell");
  await page.getByRole("button", { name: "创建模拟订单" }).click();
  await page.getByRole("button", { name: "模拟成交", exact: true }).click();
  await expect(page.getByText("已实现 -$4.20")).toBeVisible();
  await page.getByRole("button", { name: "创建模拟订单" }).click();
  await page.getByRole("button", { name: "撤单", exact: true }).click();
  await expect(page.getByText("已撤销", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/screenshots/paper-trading.png",
    fullPage: true,
  });
});

test("mobile: responsive navigation, editable trade and CSV errors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(start);
  await expect(page.getByRole("heading", { name: "当前持仓" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/screenshots/mobile.png",
    fullPage: true,
  });
  await clickNav(page, "我的持仓");
  await page.getByRole("button", { name: "录入交易" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByLabel("成交价 (USD)").fill("219");
  await page.getByRole("button", { name: "保存交易" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await clickNav(page, "导入与设置");
  await page
    .getByRole("textbox", { name: "CSV内容" })
    .fill(
      "account_id,symbol,side,quantity,price,fee,traded_at\n1,AAPL,buy,-10,220,1,2026-10-15T10:00:00-04:00",
    );
  await page.getByRole("button", { name: "校验并预览" }).click();
  await expect(
    page.getByText("预览：可接受 0 行 · 重复 0 行 · 错误 1 行"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "确认导入" })).toBeDisabled();
});

test("theme, interactive chart, help, account switch and all home shortcuts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(start);
  await expect(page.getByRole("heading", { name: "当前持仓" })).toBeVisible();
  await expect(page.getByText("暂无今日行情")).toBeVisible();
  await page.getByRole("button", { name: "使用指南" }).click();
  await expect(page.getByRole("dialog")).toContainText("导入持仓");
  await page.getByRole("button", { name: "开始体验" }).click();
  await page.getByRole("button", { name: "切换深色模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "近5日", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "选择历史交易日" }),
  ).toHaveAttribute("max", "4");
  await page.getByRole("slider").focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("slider")).toHaveValue("0");
  await page.getByRole("button", { name: "近20日", exact: true }).click();
  await expect(page.getByRole("slider")).toHaveAttribute("max", "19");
  await page.getByRole("button", { name: "全部样例", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../docs/screenshots/${offline ? "offline" : "server"}-dark.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切换浅色模式" }).click();
  await page.getByRole("combobox", { name: "账户视图" }).selectOption("2");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(4);
  await page.getByRole("combobox", { name: "账户视图" }).selectOption("");
  await page.getByRole("button", { name: "刷新数据" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出持仓", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("positions.csv");
  for (const [button, heading] of [
    ["股票观察池", "股票研究与观察池"],
    ["模拟交易", "创建模拟交易计划"],
    ["分析报告", "持仓诊断"],
    ["美股与 A 股持仓", "我的持仓"],
  ]) {
    await clickNav(page, "资产总览");
    await page
      .locator(".home-shortcuts")
      .getByRole("button", { name: new RegExp(button) })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).last(),
    ).toBeVisible();
  }
});

test("trade edit/delete, downloads, rules, reports and mobile navigation", async ({
  page,
}) => {
  await page.goto(start);
  await clickNav(page, "导入与设置");
  const template = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载模板", exact: true }).click();
  expect((await template).suggestedFilename()).toContain("template.csv");
  await page.getByRole("button", { name: "新增交易" }).click();
  await page.getByRole("dialog").getByLabel("成交价 (USD)").fill("218");
  await page.getByRole("button", { name: "保存交易" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "218.00" });
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("dialog").getByLabel("手续费 (USD)").fill("2");
  await page.getByRole("button", { name: "保存交易" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await expect(row).toHaveCount(0);
  const rules = page.getByRole("textbox", { name: "交易规则JSON" });
  const original = await rules.inputValue();
  await rules.fill(JSON.stringify({ ...JSON.parse(original), lot: 0 }));
  await page.getByRole("button", { name: "保存模拟规则" }).click();
  await expect(page.getByRole("status")).toContainText(/lot|无效|交易单位/);
  await rules.fill(original);
  await page.getByRole("button", { name: "保存模拟规则" }).click();
  await expect(page.getByRole("status")).toContainText("模拟参数已保存");
  await clickNav(page, "持仓诊断");
  await page.getByRole("combobox", { name: "报告类型" }).selectOption("weekly");
  await page.getByRole("button", { name: "生成报告" }).click();
  const report = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 JSON" }).first().click();
  expect((await report).suggestedFilename()).toMatch(/report-\d+\.json/);
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await clickNav(page, "资产总览");
  await page.getByRole("button", { name: "切换深色模式" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `../docs/screenshots/${offline ? "offline" : "server"}-mobile-dark.png`,
    fullPage: true,
  });
  for (const name of [
    "资产总览",
    "我的持仓",
    "持仓诊断",
    "股票研究",
    "模拟交易",
    "风控中心",
    "导入与设置",
  ]) {
    await clickNav(page, name);
    await expect(
      page.getByRole("heading", { name, exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("transport boundary and per-page runtime errors", async ({ page }) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && request.resourceType() !== "document")
      requests.push(request.url());
  });
  await page.goto(start);
  for (const name of [
    "资产总览",
    "我的持仓",
    "持仓诊断",
    "股票研究",
    "模拟交易",
    "风控中心",
    "导入与设置",
  ]) {
    await clickNav(page, name);
    await expect(
      page.getByRole("heading", { name, exact: true }).first(),
    ).toBeVisible();
  }
  if (offline || hostedDemo) await page.context().setOffline(true);
  await clickNav(page, "持仓诊断");
  await page.getByRole("button", { name: "生成报告" }).click();
  await expect(
    page.getByRole("button", { name: "下载 JSON" }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
  if (offline) expect(requests).toEqual([]);
  else if (hostedDemo) {
    const origin = new URL(page.url()).origin;
    expect(requests.some((url) => new URL(url).pathname.startsWith("/api"))).toBe(false);
    expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
  } else
    expect(requests.some((url) => url.endsWith("/api/positions"))).toBe(true);
});
