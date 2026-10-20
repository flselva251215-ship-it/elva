import { isOffline, offlineAPI, offlineCSV } from "./offline";
export type Amount = string;
export interface Metrics {
  ma20: number | null;
  rsi14: number | null;
  volatility: number | null;
  drawdown: number | null;
  score: number | null;
}
export interface Stock {
  demo?: boolean;
  provenance?: QuoteProvenance;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  sector: string;
  rule_key: string;
  price: Amount | null;
  timestamp: string | null;
  source: string;
  stale: boolean;
  metrics: Metrics;
  score_formula: string;
  limitations: string;
  bars?: { timestamp: string; close: Amount; volume: number }[];
}
export interface Account {
  id: number;
  name: string;
  currency: string;
  initial_cash: Amount;
  paper: boolean;
}
export interface Totals {
  total_pnl: Amount | null;
  today_pnl: Amount | null;
  latest_session_pnl: Amount | null;
  latest_session_date: string | null;
  equity: Amount | null;
  cash: Amount | null;
  market_value: Amount | null;
  realized: Amount;
  unrealized: Amount | null;
  return_pct: Amount | null;
  initial_cash: Amount;
  currency: string;
}
export interface AccountValue extends Account, Totals {
  missing_prices: string[];
}
export interface Position extends Stock {
  account_id: number;
  quantity: Amount;
  cost: Amount;
  realized: Amount;
  average_cost: Amount;
  market_value: Amount | null;
  unrealized: Amount | null;
  return_pct: Amount | null;
  weight: Amount | null;
  contribution_cny: Amount | null;
}
export interface Portfolio {
  demo?: boolean;
  accounts: AccountValue[];
  positions: Position[];
  combined: Totals;
  as_of: string | null;
  fx: {
    pair: string;
    rate: Amount;
    timestamp: string;
    source: string;
    stale: boolean;
    provenance?: QuoteProvenance;
  } | null;
  warnings: string[];
}
export interface Policy {
  single_limit: Amount;
  sector_limit: Amount;
  max_loss: Amount;
  cash_floor: Amount;
  order_limit: Amount;
}
export interface Diagnostic extends Position {
  risk_score: number;
  status: string;
  reasons: string[];
  formula: string;
  risk_note: string;
  engine: string;
  scenarios: {
    name: string;
    quantity: Amount;
    fees: Amount;
    slippage_cost: Amount;
    proceeds: Amount;
    down_10_loss: Amount;
    up_10_gain: Amount;
    assumption: string;
    trigger: string;
  }[];
}
export interface Risk {
  diagnostics: Diagnostic[];
  alerts: { symbol: string; level: string; message: string }[];
  sectors: Record<string, Amount>;
  stress: { name: string; change_cny: Amount | null }[];
  stress_note: string;
  policy: Policy;
  generated_at: string;
  as_of: string | null;
}
export interface Trade {
  id: number;
  account_id: number;
  symbol: string;
  side: string;
  quantity: Amount;
  price: Amount;
  fee: Amount;
  traded_at: string;
  paper_order_id: number | null;
}
export interface Order {
  id: number;
  account_id: number;
  symbol: string;
  side: string;
  quantity: Amount;
  status: string;
  created_at: string;
  executed_at: string | null;
  fill_price: Amount | null;
  fee: Amount | null;
  reason: string | null;
  note: string;
}
export interface SavedReport {
  id: number;
  created_at: string;
  kind: string;
  payload: string;
}
export interface Audit {
  id: number;
  created_at: string;
  action: string;
  detail: string;
}
export interface Rules {
  rules: Record<string, Record<string, unknown>>;
  source: string;
}
export interface ImportResult {
  dry_run: boolean;
  accepted: number;
  duplicates: number[];
  errors: { line: number; error: string }[];
}
export interface Data {
  feed?: FeedStatus;
  accounts: Account[];
  portfolio: Portfolio;
  risk: Risk;
  market: Stock[];
  paper: Portfolio;
  orders: Order[];
  trades: Trade[];
  watchlist: string[];
  policy: Policy;
  rules: Rules;
  reports: SavedReport[];
  audit: Audit[];
}

export interface QuoteProvenance {
  source?: string;
  as_of_date?: string;
  fetched_at?: string | null;
  attempted_at?: string | null;
  timestamp_precision?: string;
  delay?: string;
  error?: string | null;
  stale?: boolean;
  status?: string;
  cached?: boolean;
  retry_after?: string | null;
}
export interface FeedStatus {
  mode: "real" | "demo";
  twelve_key_present: boolean;
  twelve_personal_use: boolean;
  akshare_personal_use: boolean;
  akshare_license_reference: string;
  refresh_minutes: number;
  success_cache_hours: number;
  minute_budget: number;
  daily_budget: number;
  budget_note: string;
  sources: { provider: string; name: string; blocked_reason: string | null }[];
  quotes: Record<string, QuoteProvenance>;
  fx: QuoteProvenance;
}
export interface EquityHistory {
  account_id: number;
  currency: string;
  demo?: boolean;
  note: string;
  points: { date: string; equity: Amount; return_pct: Amount }[];
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (isOffline) return offlineAPI<T>(path, method, body);
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "服务未连接或返回格式错误。离线体验请打开 StockPilot-演示体验.html；完整版请检查后端8000端口。",
    );
  }
  const result = await response.json();
  if (!response.ok) {
    const detail = result.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map(
                (e: { msg: string; loc: string[] }) =>
                  `${e.loc.join(".")}: ${e.msg}`,
              )
              .join("；")
          : "请求失败，请检查服务连接",
    );
  }
  return result;
}

export async function downloadCSV(path: string) {
  let blob: Blob;
  if (isOffline)
    blob = new Blob([offlineCSV(path)], { type: "text/csv;charset=utf-8" });
  else {
    const response = await fetch(`/api${path}`);
    if (!response.ok) throw new Error("下载失败，请检查服务连接");
    blob = await response.blob();
  }
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = path.includes("template")
    ? "stockpilot-template.csv"
    : "stockpilot-positions.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function loadData(account: string): Promise<Data> {
  const query = account ? `?account_id=${account}` : "";
  const [
    accounts,
    portfolio,
    risk,
    market,
    paper,
    orders,
    trades,
    watchlist,
    policy,
    rules,
    reports,
    audit,
    feed,
  ] = await Promise.all([
    api<Account[]>("/accounts"),
    api<Portfolio>(`/positions${query}`),
    api<Risk>(`/risk-analysis${query}`),
    api<Stock[]>("/market-data"),
    api<Portfolio>("/positions?paper=true"),
    api<Order[]>("/paper-orders"),
    api<Trade[]>("/trades"),
    api<string[]>("/watchlist"),
    api<Policy>("/risk-policy"),
    api<Rules>("/execution-rules"),
    api<SavedReport[]>("/reports"),
    api<Audit[]>("/audit-logs"),
    isOffline
      ? Promise.resolve(undefined)
      : api<FeedStatus>("/market-data/status"),
  ]);
  return {
    accounts,
    portfolio,
    risk,
    market,
    paper,
    orders,
    trades,
    watchlist,
    policy,
    rules,
    reports,
    audit,
    feed,
  };
}
