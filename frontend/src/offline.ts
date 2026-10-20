/** Private, single-file browser demo. No requests, broker code or embedded user data. */
import Decimal from "decimal.js";
import seedJSON from "./demo-seed.json";
import type {
  Account,
  AccountValue,
  Audit,
  Diagnostic,
  ImportResult,
  Order,
  Policy,
  Portfolio,
  Position,
  Risk,
  Rules,
  SavedReport,
  Stock,
  Trade,
} from "./api";
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });
const D = (v: Decimal.Value = 0) => new Decimal(v);
const sum = (v: Decimal.Value[]) => v.reduce<Decimal>((a, b) => a.plus(b), D());
const now = () => new Date().toISOString();
export const isOffline = document.documentElement.dataset.mode === "offline";
const key = "stockpilot-private-demo-v2";
type Rule = {
  name: string;
  lot: number;
  t_plus: number;
  limit_pct: string | null;
  fee_rate: string;
  min_fee: string;
  sell_tax: string;
  slippage: string;
  volume_fraction: string;
  timezone: string;
  sessions: [string, string][];
};
interface Seed {
  accounts: Account[];
  trades: Trade[];
  stocks: Stock[];
  policy: Policy;
  rules: Rules;
  watchlist: string[];
  fx: NonNullable<Portfolio["fx"]>;
  correlations: { symbols: string[]; correlation: number }[];
}
const seed = seedJSON as unknown as Seed;
interface State {
  trades: Trade[];
  orders: Order[];
  policy: Policy;
  rules: Rules;
  watchlist: string[];
  reports: SavedReport[];
  audit: Audit[];
}
let state: State | undefined;
export let offlinePersistent = true;
function store(): State {
  if (state) return state;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(key);
  } catch {
    offlinePersistent = false;
  }
  if (saved) {
    try {
      state = JSON.parse(saved) as State;
    } catch {
      throw Error(
        "本机演示数据无法读取，请使用新浏览器副本；不要覆盖已有数据。",
      );
    }
  } else
    state = {
      trades: structuredClone(seed.trades),
      orders: [],
      policy: structuredClone(seed.policy),
      rules: structuredClone(seed.rules),
      watchlist: [...seed.watchlist],
      reports: [],
      audit: [],
    };
  return state;
}
const id = (rows: { id: number }[]) =>
  Math.max(0, ...rows.map((x) => x.id)) + 1;
function log(s: State, action: string, detail: string) {
  s.audit.unshift({ id: id(s.audit), created_at: now(), action, detail });
}
function stock(symbol: string) {
  const s = seed.stocks.find((x) => x.symbol === symbol);
  if (!s) throw Error("未知股票；离线版仅支持内置6只标的");
  return s;
}
function rule(s: State, symbol: string): Rule {
  return s.rules.rules[stock(symbol).rule_key] as unknown as Rule;
}
function ledger(s: State, accountId: number, trades = s.trades) {
  const account = seed.accounts.find((a) => a.id === accountId);
  if (!account) throw Error("账户不存在");
  let cash = D(account.initial_cash);
  const lots: Record<
    string,
    { quantity: Decimal; cost: Decimal; realized: Decimal }
  > = {};
  const ordered = trades
    .filter((t) => t.account_id === accountId)
    .sort(
      (a, b) =>
        Date.parse(a.traded_at) - Date.parse(b.traded_at) || a.id - b.id,
    );
  for (const t of ordered) {
    const p = (lots[t.symbol] ||= { quantity: D(), cost: D(), realized: D() });
    const value = D(t.price).mul(t.quantity);
    if (t.side === "buy") {
      cash = cash.minus(value).minus(t.fee);
      p.quantity = p.quantity.plus(t.quantity);
      p.cost = p.cost.plus(value).plus(t.fee);
    } else {
      if (p.quantity.lt(t.quantity))
        throw Error(`${t.symbol} 在该成交时间的可用持仓不足`);
      const removed = p.cost.mul(t.quantity).div(p.quantity);
      p.quantity = p.quantity.minus(t.quantity);
      p.cost = p.cost.minus(removed);
      p.realized = p.realized.plus(value).minus(t.fee).minus(removed);
      cash = cash.plus(value).minus(t.fee);
    }
    if (cash.lt(0)) throw Error("历史交易导致现金不足");
  }
  return { account, cash, lots };
}
function localDate(value: string, zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
function portfolio(s: State, accountId?: number, paper = false): Portfolio {
  const positions: Position[] = [],
    accounts: AccountValue[] = [];
  const fx = D(seed.fx.rate);
  for (const a of seed.accounts.filter(
    (a) => a.paper === paper && (!accountId || a.id === accountId),
  )) {
    const { cash, lots } = ledger(s, a.id);
    let mv = D(),
      realized = D(),
      unrealized = D();
    for (const [symbol, p] of Object.entries(lots)) {
      realized = realized.plus(p.realized);
      if (p.quantity.isZero()) continue;
      const st = stock(symbol),
        value = p.quantity.mul(st.price!);
      const pnl = value.minus(p.cost);
      mv = mv.plus(value);
      unrealized = unrealized.plus(pnl);
      positions.push({
        ...st,
        account_id: a.id,
        quantity: p.quantity.toString(),
        cost: p.cost.toString(),
        average_cost: p.cost.div(p.quantity).toString(),
        market_value: value.toString(),
        unrealized: pnl.toString(),
        realized: p.realized.toString(),
        return_pct: p.cost.isZero() ? null : pnl.div(p.cost).toString(),
        weight: null,
        contribution_cny: pnl.mul(a.currency === "USD" ? fx : 1).toString(),
      });
    }
    const equity = cash.plus(mv),
      total = realized.plus(unrealized);
    const stocks = seed.stocks.filter((x) => x.currency === a.currency),
      bars = stocks[0].bars!;
    const lastTime = bars.at(-1)!.timestamp,
      beforeTime = bars.at(-2)!.timestamp;
    let daily: Decimal | null = null;
    if (
      !s.trades.some(
        (t) =>
          t.account_id === a.id &&
          Date.parse(t.traded_at) > Date.parse(lastTime),
      )
    ) {
      const old = ledger(
        s,
        a.id,
        s.trades.filter(
          (t) => Date.parse(t.traded_at) <= Date.parse(beforeTime),
        ),
      );
      const oldValue = sum(
        Object.entries(old.lots).map(([symbol, p]) =>
          p.quantity.mul(stock(symbol).bars!.at(-2)!.close),
        ),
      );
      daily = equity.minus(old.cash.plus(oldValue));
    }
    const zone = a.currency === "USD" ? "America/New_York" : "Asia/Shanghai";
    accounts.push({
      ...a,
      cash: cash.toString(),
      market_value: mv.toString(),
      equity: equity.toString(),
      realized: realized.toString(),
      unrealized: unrealized.toString(),
      total_pnl: total.toString(),
      today_pnl:
        localDate(now(), zone) === localDate(lastTime, zone)
          ? (daily?.toString() ?? null)
          : null,
      latest_session_pnl: daily?.toString() ?? null,
      latest_session_date: localDate(lastTime, zone),
      return_pct: total.div(a.initial_cash).toString(),
      missing_prices: [],
    });
  }
  if (accountId && !accounts.length) throw Error("该视图下账户不存在");
  const combined = { currency: "CNY" } as Portfolio["combined"];
  for (const field of [
    "cash",
    "equity",
    "market_value",
    "realized",
    "unrealized",
    "initial_cash",
    "total_pnl",
    "today_pnl",
    "latest_session_pnl",
  ] as const) {
    const values = accounts.map((a) =>
      a[field] == null ? null : D(a[field]!).mul(a.currency === "USD" ? fx : 1),
    );
    (combined as unknown as Record<string, unknown>)[field] = values.some(
      (v) => v === null,
    )
      ? null
      : sum(values as Decimal[]).toString();
  }
  combined.return_pct = D(combined.initial_cash).gt(0)
    ? D(combined.total_pnl!).div(combined.initial_cash).toString()
    : null;
  combined.latest_session_date = accounts[0]?.latest_session_date ?? null;
  for (const p of positions)
    p.weight = D(combined.equity!).gt(0)
      ? D(p.market_value!)
          .mul(p.currency === "USD" ? fx : 1)
          .div(combined.equity!)
          .toString()
      : null;
  return {
    accounts,
    positions,
    combined,
    fx: seed.fx,
    as_of:
      positions
        .map((p) => p.timestamp!)
        .sort()
        .at(-1) || null,
    warnings: ["离线演示，数据只在本机浏览器；全部价格与汇率为虚构样例"],
  };
}
function risk(s: State, accountId?: number): Risk {
  const data = portfolio(s, accountId),
    policy = s.policy;
  const alerts: Risk["alerts"] = [],
    diagnostics: Diagnostic[] = [],
    sectors: Record<string, string> = {};
  for (const p of data.positions) {
    const reasons: string[] = [];
    let score = 0;
    const add = (test: boolean, message: string, points: number) => {
      if (test) {
        reasons.push(message);
        score += points;
      }
    };
    add(D(p.weight || 0).gt(policy.single_limit), "单股仓位超过上限", 35);
    add(
      D(p.return_pct || 0).lt(D(policy.max_loss).neg()),
      "持仓亏损超过承受阈值",
      35,
    );
    add((p.metrics.volatility || 0) > 0.35, "历史年化波动超过 35%", 15);
    add(
      (p.metrics.drawdown || 0) < -Number(policy.max_loss),
      "历史最大回撤超过承受阈值",
      20,
    );
    add(p.stale, "行情过期或缺失，需要复核", 20);
    const bars = stock(p.symbol).bars!;
    add(
      D(bars.at(-1)!.close).div(bars.at(-2)!.close).minus(1).abs().gt(0.05),
      "最新收盘变化超过 5%（无开盘数据）",
      15,
    );
    sectors[p.sector] = D(sectors[p.sector] || 0)
      .plus(p.weight || 0)
      .toString();
    const r = rule(s, p.symbol);
    const scenarios = D(p.unrealized!).lt(0)
      ? [0, 0.5, 1].map((fraction, i) => {
          const qty =
            fraction === 0.5
              ? D(p.quantity).mul(0.5).div(r.lot).floor().mul(r.lot)
              : D(p.quantity).mul(fraction);
          const gross = qty.mul(p.price!),
            slip = gross.mul(r.slippage),
            net = gross.minus(slip);
          const fees = qty.gt(0)
            ? Decimal.max(net.mul(r.fee_rate), r.min_fee).plus(
                net.mul(r.sell_tax),
              )
            : D();
          const remaining = D(p.quantity).minus(qty).mul(p.price!);
          return {
            name: ["继续持有", "逐步减仓", "退出"][i],
            quantity: qty.toString(),
            fees: fees.toString(),
            slippage_cost: slip.toString(),
            proceeds: net.minus(fees).toString(),
            down_10_loss: remaining
              .mul(-0.1)
              .minus(fees)
              .minus(slip)
              .toString(),
            up_10_gain: remaining.mul(0.1).minus(fees).minus(slip).toString(),
            assumption:
              "假设样例价格成交、余仓随后±10%；相对当前市值变化，非预测",
            trigger: "数据更新并复核风险预算后评估，遵守可卖数量与交易规则",
          };
        })
      : [];
    diagnostics.push({
      ...p,
      risk_score: Math.min(score, 100),
      status: score >= 50 ? "风险偏高" : score ? "需要复核" : "继续观察",
      reasons,
      scenarios,
      engine: "离线规则引擎",
      formula:
        "风险分=超单股限额35+超亏损阈值35+波动>35%加15+回撤超限20+过期20+收盘变动>5%加15，上限100。平均成本含买入费。",
      risk_note:
        "补仓会扩大敞口，不能保证回本；需复核真实数据，本页不提供确定性买卖命令。",
    });
    alerts.push(
      ...reasons.map((message) => ({
        symbol: p.symbol,
        level: score >= 50 ? "high" : "review",
        message,
      })),
    );
  }
  for (const [sector, value] of Object.entries(sectors))
    if (D(value).gt(policy.sector_limit))
      alerts.push({
        symbol: sector,
        level: "high",
        message: "行业敞口超过上限",
      });
  if (
    D(data.combined.equity!).gt(0) &&
    D(data.combined.cash!).div(data.combined.equity!).lt(policy.cash_floor)
  )
    alerts.push({ symbol: "组合", level: "high", message: "现金比例低于底线" });
  alerts.push({
    symbol: "汇率",
    level: "review",
    message: "固定演示汇率已过期，存在汇率风险",
  });
  for (const pair of seed.correlations.filter((pair) =>
    pair.symbols.every((symbol) =>
      data.positions.some((p) => p.symbol === symbol),
    ),
  ))
    alerts.push({
      symbol: pair.symbols.join("/"),
      level: "review",
      message: `样例收益相关性超过 0.8（${pair.correlation}）`,
    });
  const usd = sum(
    data.accounts.filter((a) => a.currency === "USD").map((a) => a.equity!),
  );
  return {
    diagnostics,
    alerts,
    sectors,
    policy,
    generated_at: now(),
    as_of: data.as_of,
    stress: [5, 10]
      .map((pct) => ({
        name: `全部股票价格下跌 ${pct}%`,
        change_cny: D(data.combined.market_value!)
          .mul(pct)
          .div(-100)
          .toString(),
      }))
      .concat([
        {
          name: "美元兑人民币下跌 5%（美元资产折算）",
          change_cny: usd.mul(seed.fx.rate).mul(-0.05).toString(),
        },
      ]),
    stress_note:
      "假设模拟而非预测；统一股票冲击不代表指数beta，现金不受股票跌幅影响。",
  };
}
function validateTrade(s: State, input: Trade, existingId?: number): Trade {
  const a = seed.accounts.find((a) => a.id === Number(input.account_id));
  if (!a || a.paper) throw Error("请选择持仓记录账户（非模拟账户）");
  const st = stock(input.symbol);
  if (a.currency !== st.currency) throw Error("股票币种与账户不匹配");
  if (!["buy", "sell"].includes(input.side)) throw Error("方向必须为buy/sell");
  for (const field of ["quantity", "price", "fee"] as const) {
    const v = D(input[field]);
    if (
      !v.isFinite() ||
      v.lt(0) ||
      (field !== "fee" && v.isZero()) ||
      v.gt(1e9) ||
      v.decimalPlaces() > 6
    )
      throw Error(`${field} 必须为有效金额/数量，最多6位小数`);
  }
  if (
    !/(Z|[+-]\d{2}:\d{2})$/i.test(input.traded_at) ||
    !Number.isFinite(Date.parse(input.traded_at))
  )
    throw Error("成交时间必须是包含时区的ISO8601时间");
  if (Date.parse(input.traded_at) > Date.now())
    throw Error("成交时间不能晚于当前时间");
  const candidate = {
    ...input,
    account_id: a.id,
    traded_at: new Date(input.traded_at).toISOString(),
    id: existingId ?? id(s.trades),
    paper_order_id: null,
  };
  const equal = (t: Trade) =>
    t.account_id === a.id &&
    t.symbol === input.symbol &&
    t.side === input.side &&
    ["quantity", "price", "fee"].every((k) =>
      D(t[k as "price"]).eq(input[k as "price"]),
    ) &&
    Date.parse(t.traded_at) === Date.parse(input.traded_at);
  if (s.trades.some((t) => t.id !== existingId && equal(t)))
    throw Error("检测到重复交易，未再次导入");
  ledger(s, a.id, [...s.trades.filter((t) => t.id !== existingId), candidate]);
  return candidate;
}
function validatePolicy(p: Policy) {
  for (const field of [
    "single_limit",
    "sector_limit",
    "max_loss",
    "cash_floor",
    "order_limit",
  ] as const) {
    const v = D(p[field]);
    if (
      !v.isFinite() ||
      v.lt(field === "cash_floor" ? 0 : 0.000000001) ||
      v.gt(field === "order_limit" ? 1e9 : 1)
    )
      throw Error("风险比例须为0至1内的有效数值，金额上限必须为正数");
  }
}
function validateRule(r: Rule, name: string) {
  if (
    !Number.isInteger(r.lot) ||
    r.lot < 1 ||
    r.lot > 10000 ||
    ![0, 1].includes(r.t_plus)
  )
    throw Error("交易单位或T+参数无效");
  if (
    r.timezone !==
    (name.startsWith("CN_") ? "Asia/Shanghai" : "America/New_York")
  )
    throw Error("规则时区必须与市场一致");
  let previous = "00:00";
  if (!Array.isArray(r.sessions) || !r.sessions.length || r.sessions.length > 4)
    throw Error("交易时段无效");
  for (const [a, b] of r.sessions) {
    if (
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(a) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(b) ||
      a >= b ||
      a < previous
    )
      throw Error("时段必须顺序排列，格式HH:MM且不重叠");
    previous = b;
  }
  for (const f of [
    "fee_rate",
    "min_fee",
    "sell_tax",
    "slippage",
    "volume_fraction",
    "limit_pct",
  ] as const) {
    if (f === "limit_pct" && r[f] === null) continue;
    const v = D(r[f]!);
    const max =
      f === "min_fee"
        ? 1e9
        : f === "slippage"
          ? 0.05
          : ["fee_rate", "sell_tax"].includes(f)
            ? 0.1
            : 1;
    if (
      !v.isFinite() ||
      v.lt(0) ||
      v.gt(max) ||
      (["volume_fraction", "limit_pct"].includes(f) && v.isZero())
    )
      throw Error("模拟费率、限幅或参与率无效");
  }
}
function execute(s: State, o: Order, demo: boolean) {
  if (o.status !== "pending") throw Error("仅待成交订单可执行，不可重复成交");
  try {
    const st = stock(o.symbol),
      r = rule(s, o.symbol),
      bars = st.bars!,
      bar = bars.at(-1)!;
    const { cash, lots } = ledger(s, o.account_id),
      held = lots[o.symbol]?.quantity || D();
    if (!demo) throw Error("行情过期；需明确勾选历史演示时钟才能演练");
    const at = bar.timestamp,
      parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: r.timezone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(at));
    const part = (key: string) => parts.find((p) => p.type === key)!.value;
    const hhmm = `${part("hour")}:${part("minute")}`;
    if (
      ["Sat", "Sun"].includes(part("weekday")) ||
      !r.sessions.some(([a, b]) => a <= hhmm && hhmm < b)
    )
      throw Error("当前不在配置的模拟交易时段内");
    if (
      s.trades.some(
        (t) =>
          t.account_id === o.account_id &&
          Date.parse(t.traded_at) > Date.parse(at),
      )
    )
      throw Error("演示时钟早于已有成交");
    const qty = D(o.quantity);
    if (!qty.mod(r.lot).isZero() && !(o.side === "sell" && qty.eq(held)))
      throw Error(`本标的交易单位为 ${r.lot} 股`);
    const todayBuys = sum(
      s.trades
        .filter(
          (t) =>
            t.account_id === o.account_id &&
            t.symbol === o.symbol &&
            t.side === "buy" &&
            localDate(t.traded_at, r.timezone) === localDate(at, r.timezone),
        )
        .map((t) => t.quantity),
    );
    if (o.side === "sell" && qty.gt(held.minus(r.t_plus ? todayBuys : 0)))
      throw Error("可卖数量不足或触发 A 股 T+1 限制");
    if (qty.gt(D(bar.volume).mul(r.volume_fraction)))
      throw Error("超过样例日成交量参与率上限");
    const price = D(bar.close)
      .mul(D(1).plus(D(r.slippage).mul(o.side === "buy" ? 1 : -1)))
      .toDecimalPlaces(2);
    if (
      r.limit_pct !== null &&
      price.div(bars.at(-2)!.close).minus(1).abs().gt(r.limit_pct)
    )
      throw Error("模拟成交价超过配置的昨收涨跌幅限制");
    const value = qty.mul(price),
      fee = Decimal.max(value.mul(r.fee_rate), r.min_fee)
        .plus(o.side === "sell" ? value.mul(r.sell_tax) : 0)
        .toDecimalPlaces(2);
    if (value.gt(s.policy.order_limit))
      throw Error("计划交易金额超过风控上限（账户币种）");
    if (o.side === "buy" && value.plus(fee).gt(cash))
      throw Error("虚拟现金不足（含费用和滑点）");
    const equity = D(portfolio(s, o.account_id, true).accounts[0].equity!);
    if (
      o.side === "buy" &&
      equity.gt(0) &&
      cash
        .minus(value)
        .minus(fee)
        .div(equity.minus(fee))
        .lt(s.policy.cash_floor)
    )
      throw Error("本次买入将低于现金底线");
    const t: Trade = {
      id: id(s.trades),
      account_id: o.account_id,
      symbol: o.symbol,
      side: o.side,
      quantity: o.quantity,
      price: price.toFixed(2),
      fee: fee.toFixed(2),
      traded_at: at,
      paper_order_id: o.id,
    };
    ledger(s, o.account_id, [...s.trades, t]);
    s.trades.push(t);
    Object.assign(o, {
      status: "filled",
      fill_price: t.price,
      fee: t.fee,
      executed_at: at,
      reason: "历史演示时钟成交（虚构行情，本机浏览器计算）",
    });
  } catch (e) {
    o.status = "rejected";
    o.reason = e instanceof Error ? e.message : String(e);
  }
  log(s, `paper_order_${o.status}`, `order=${o.id}; ${o.reason}`);
  return o;
}
const csvFields = [
  "account_id",
  "symbol",
  "side",
  "quantity",
  "price",
  "fee",
  "traded_at",
];
export function offlineCSV(path: string): string {
  if (path.includes("template"))
    return (
      csvFields.join(",") + "\n1,AAPL,buy,10,220,1,2026-10-15T10:00:00-04:00\n"
    );
  const fields = [
    "account_id",
    "symbol",
    "currency",
    "quantity",
    "average_cost",
    "price",
    "market_value",
    "unrealized",
    "realized",
    "timestamp",
    "source",
  ] as const;
  const escape = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  return (
    "\ufeff" +
    [
      fields.join(","),
      ...portfolio(store()).positions.map((p) =>
        fields.map((f) => escape(p[f])).join(","),
      ),
    ].join("\n")
  );
}
function importCSV(
  s: State,
  input: { content: string; dry_run: boolean },
): ImportResult {
  if (new TextEncoder().encode(input.content).length > 1e6)
    throw Error("文件超过1 MB");
  const lines = input.content
    .replace(/^\ufeff/, "")
    .trim()
    .split(/\r?\n/);
  if (lines[0].split(",").sort().join() !== [...csvFields].sort().join())
    throw Error("CSV表头必须与模板一致");
  const headers = lines[0].split(","),
    parsed: { line: number; trade: Trade }[] = [],
    errors: ImportResult["errors"] = [],
    duplicates: number[] = [];
  if (lines.length > 1001)
    return {
      dry_run: input.dry_run,
      accepted: 0,
      duplicates: [],
      errors: [{ line: 1002, error: "单次最多1000行" }],
    };
  lines.slice(1).forEach((line, index) => {
    if (!line.trim()) return;
    // Strict flat CSV; template has no quoted/multiline fields, reject rather than misread.
    const cells = line.split(",");
    if (cells.length !== headers.length || cells.some((c) => c.includes('"'))) {
      errors.push({
        line: index + 2,
        error: "离线演示仅接受模板的无引号7列CSV；复杂CSV请使用完整后端版本",
      });
      return;
    }
    const record = Object.fromEntries(
      headers.map((h, i) => [h, cells[i].trim()]),
    );
    parsed.push({
      line: index + 2,
      trade: {
        ...record,
        account_id: Number(record.account_id),
      } as unknown as Trade,
    });
  });
  const working = structuredClone(s);
  for (const row of parsed.sort(
    (a, b) => Date.parse(a.trade.traded_at) - Date.parse(b.trade.traded_at),
  )) {
    try {
      working.trades.push(validateTrade(working, row.trade));
    } catch (e) {
      const error = String(e);
      if (error.includes("重复交易")) duplicates.push(row.line);
      else errors.push({ line: row.line, error });
    }
  }
  const accepted = errors.length ? 0 : parsed.length - duplicates.length;
  if (!input.dry_run && !errors.length) {
    s.trades = working.trades;
    log(
      s,
      "csv_import",
      `accepted=${accepted}; duplicates=${duplicates.length}`,
    );
  }
  return { dry_run: input.dry_run, accepted, duplicates, errors };
}
/** Routes deliberately mirror the local FastAPI transport; mutations commit atomically. */
export async function offlineAPI<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const url = new URL(path, "http://offline.invalid"),
    p = url.pathname,
    params = url.searchParams;
  const current = store(),
    s = method === "GET" ? current : structuredClone(current);
  let result: unknown;
  const limit = Number(params.get("limit") || 100),
    offset = Number(params.get("offset") || 0);
  const paged = <U>(rows: U[]) => rows.slice(offset, offset + limit);
  if (p === "/accounts") result = seed.accounts;
  else if (p === "/positions")
    result = portfolio(
      s,
      Number(params.get("account_id")) || undefined,
      params.get("paper") === "true",
    );
  else if (p === "/risk-analysis")
    result = risk(s, Number(params.get("account_id")) || undefined);
  else if (p === "/market-data")
    result = seed.stocks.filter(
      (x) =>
        (!params.get("market") || x.market === params.get("market")) &&
        (x.name + x.symbol)
          .toLowerCase()
          .includes((params.get("q") || "").toLowerCase()),
    );
  else if (p.startsWith("/market-data/")) result = stock(p.split("/").at(-1)!);
  else if (p === "/watchlist") result = s.watchlist;
  else if (p.startsWith("/watchlist/")) {
    const symbol = p.split("/").at(-1)!;
    stock(symbol);
    s.watchlist = s.watchlist.filter((x) => x !== symbol);
    if (method === "PUT") s.watchlist.push(symbol);
    log(s, "watch_updated", symbol);
    result = { symbol };
  } else if (p === "/risk-policy") {
    if (method === "PUT") {
      validatePolicy(body as Policy);
      s.policy = body as Policy;
      log(s, "risk_policy_updated", "用户调整模拟风险阈值");
    }
    result = s.policy;
  } else if (p === "/execution-rules") result = s.rules;
  else if (p.startsWith("/execution-rules/")) {
    const name = p.split("/").at(-1)!;
    if (!s.rules.rules[name]) throw Error("规则不存在");
    validateRule(body as Rule, name);
    s.rules.rules[name] = body as Record<string, unknown>;
    log(s, "execution_rule_updated", name);
    result = s.rules;
  } else if (p === "/trades/import")
    result = importCSV(s, body as { content: string; dry_run: boolean });
  else if (p === "/trades" && method === "GET")
    result = paged(
      [...s.trades]
        .filter(
          (t) =>
            !params.get("account_id") ||
            t.account_id === Number(params.get("account_id")),
        )
        .sort(
          (a, b) =>
            Date.parse(b.traded_at) - Date.parse(a.traded_at) || b.id - a.id,
        ),
    );
  else if (p === "/trades" && method === "POST") {
    const t = validateTrade(s, body as Trade);
    s.trades.push(t);
    log(s, "trade_created", `trade=${t.id}`);
    result = t;
  } else if (p.startsWith("/trades/")) {
    const t = s.trades.find((t) => t.id === Number(p.split("/").at(-1)));
    if (!t) throw Error("交易不存在");
    if (t.paper_order_id) throw Error("模拟成交不可修改或删除");
    if (method === "DELETE") {
      if (params.get("confirm") !== "true") throw Error("删除需要确认");
      const remaining = s.trades.filter((x) => x.id !== t.id);
      ledger(s, t.account_id, remaining);
      s.trades = remaining;
      result = { deleted: t.id };
    } else {
      if (Number((body as Trade).account_id) !== t.account_id)
        throw Error("修改交易不能迁移账户");
      const updated = validateTrade(s, body as Trade, t.id);
      s.trades = s.trades.map((x) => (x.id === t.id ? updated : x));
      result = updated;
    }
    log(
      s,
      method === "DELETE" ? "trade_deleted" : "trade_edited",
      JSON.stringify({ before: t, after: result }),
    );
  } else if (p === "/paper-orders" && method === "GET")
    result = paged([...s.orders].reverse());
  else if (p === "/paper-orders" && method === "POST") {
    const input = body as Order;
    const a = seed.accounts.find((a) => a.id === Number(input.account_id));
    if (!a?.paper || a.currency !== stock(input.symbol).currency)
      throw Error("请选择匹配币种的虚拟账户");
    if (
      !["buy", "sell"].includes(input.side) ||
      !D(input.quantity).isFinite() ||
      D(input.quantity).lte(0) ||
      D(input.quantity).gt(1e9) ||
      D(input.quantity).decimalPlaces() > 6
    )
      throw Error("订单方向或股数无效");
    const o: Order = {
      ...input,
      id: id(s.orders),
      account_id: a.id,
      status: "pending",
      created_at: now(),
      executed_at: null,
      fill_price: null,
      fee: null,
      reason: null,
    };
    s.orders.push(o);
    log(s, "paper_order_created", `order=${o.id}`);
    result = o;
  } else if (p.startsWith("/paper-orders/")) {
    const parts = p.split("/");
    const o = s.orders.find((o) => o.id === Number(parts[2]));
    if (!o || o.status !== "pending") throw Error("只能操作待成交订单");
    if (parts[3] === "fill")
      result = execute(
        s,
        o,
        Boolean((body as { demo_clock: boolean }).demo_clock),
      );
    else if (parts[3] === "cancel") {
      o.status = "cancelled";
      o.reason = "用户撤销模拟订单";
      log(s, "paper_order_cancelled", `order=${o.id}`);
      result = o;
    } else throw Error("未知订单操作");
  } else if (p === "/reports" && method === "GET") result = paged(s.reports);
  else if (p === "/reports" && method === "POST") {
    const r: SavedReport = {
      id: id(s.reports),
      created_at: now(),
      kind: params.get("kind") || "daily",
      payload: JSON.stringify({
        portfolio: portfolio(s),
        risk: risk(s),
        paper: portfolio(s, undefined, true),
        note: "离线浏览器演示快照，非期间收益或预测",
      }),
    };
    s.reports.unshift(r);
    log(s, "report_created", r.kind);
    result = r;
  } else if (p === "/audit-logs") result = paged(s.audit);
  else throw Error("离线演示不支持此操作；无真实交易接口");
  if (method !== "GET") {
    if (offlinePersistent) localStorage.setItem(key, JSON.stringify(s));
    state = s;
  }
  return structuredClone(result) as T;
}
