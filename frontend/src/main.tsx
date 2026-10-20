import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  FlaskConical,
  Globe2,
  LayoutDashboard,
  Leaf,
  ListFilter,
  LoaderCircle,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import {
  api,
  loadData,
  downloadCSV,
  type Data,
  type ImportResult,
  type Order,
  type Policy,
  type Position,
  type SavedReport,
  type Stock,
  type QuoteProvenance,
  type Trade,
} from "./api";
import { isOffline, offlinePersistent } from "./offline";
import "./style.css";
import "./enhancements.css";
import "./apple.css";
import "./visual-refresh.css";
import { MarketConnection } from "./MarketConnection";
import { BeginnerGuide } from "./BeginnerGuide";
import { EquityChart } from "./EquityChart";

const pages = [
  { title: "资产总览", sub: "PORTFOLIO OVERVIEW", icon: LayoutDashboard },
  { title: "我的持仓", sub: "MY POSITIONS", icon: Wallet },
  { title: "持仓诊断", sub: "INTELLIGENT INSIGHTS", icon: Sparkles },
  { title: "股票研究", sub: "MARKET RESEARCH", icon: BookOpen },
  { title: "模拟交易", sub: "PAPER TRADING", icon: FlaskConical },
  { title: "风控中心", sub: "RISK MANAGEMENT", icon: Shield },
  { title: "导入与设置", sub: "DATA & SETTINGS", icon: Settings2 },
];
const navGroups = [
  { title: "资产管理", icon: Wallet, pageIds: [0, 1] },
  { title: "研究分析", icon: BookOpen, pageIds: [2, 3] },
  { title: "交易与风控", icon: Shield, pageIds: [4, 5] },
  { title: "系统设置", icon: Settings2, pageIds: [6] },
];

const amount = (
  value: string | number | null | undefined,
  currency = "",
  digits = 2,
) =>
  value == null
    ? "暂无数据"
    : `${Number(value) < 0 ? "-" : ""}${currency === "USD" ? "$" : currency === "CNY" ? "¥" : ""}${Math.abs(Number(value)).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const percent = (value: string | number | null | undefined) =>
  value == null ? "暂无数据" : `${(Number(value) * 100).toFixed(2)}%`;
const tone = (value: string | null | undefined) =>
  value == null ? "unavailable" : Number(value) < 0 ? "negative" : "positive";
const date = (value: string | null, zone = "Asia/Shanghai") =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "暂无时间";
const status: Record<string, string> = {
  pending: "待成交",
  filled: "已成交",
  rejected: "已拒绝",
  cancelled: "已撤销",
};
type Action = (work: () => Promise<unknown>, success?: string) => Promise<void>;

function CSVLink({
  path,
  children,
  className = "outline-button",
}: {
  path: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <span className="download-control">
      <button
        className={className}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setError("");
          try {
            await downloadCSV(path);
          } catch (e) {
            setError(String(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Download size={15} />
        )}{" "}
        {children}
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}

function Badge({
  children,
  kind = "",
}: {
  children: React.ReactNode;
  kind?: string;
}) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
function Empty({
  text = "暂无记录，完成第一笔操作后将在这里显示。",
}: {
  text?: string;
}) {
  return (
    <div className="empty">
      <Leaf size={26} />
      <p>{text}</p>
    </div>
  );
}
function Source({
  timestamp,
  source,
  provenance,
}: {
  timestamp: string | null;
  source?: string;
  provenance?: QuoteProvenance;
}) {
  return (
    <p className="source">
      {source || "数据来源尚未确认"} ·{" "}
      {timestamp
        ? /Twelve|AKShare|Frankfurter/.test(source || "")
          ? `${timestamp.slice(0, 10)}（供应商仅提供日期，不是逐笔报价时刻）`
          : `${date(timestamp)}（上海） / ${date(timestamp, "America/New_York")}（纽约）`
        : "尚无报价更新时间"}
      {provenance?.fetched_at && (
        <> · 抓取于 {date(provenance.fetched_at)}（上海）</>
      )}
      {provenance?.delay && <> · {provenance.delay}</>}
      {provenance?.error && (
        <strong className="feed-error"> · {provenance.error}</strong>
      )}
    </p>
  );
}

function PriceChart({
  stock,
  compact = false,
}: {
  stock: Stock | null;
  compact?: boolean;
}) {
  const [point, setPoint] = useState<number | null>(null);
  const [range, setRange] = useState(65);
  const bars = (stock?.bars || []).slice(-range);
  if (!bars.length)
    return <Empty text="暂无当前模式的历史行情；请查看行情连接状态。" />;
  const prices = bars.map((b) => Number(b.close));
  const low = Math.min(...prices) * 0.985,
    high = Math.max(...prices) * 1.015;
  const w = 780,
    h = compact ? 150 : 220;
  const coords = prices.map((p, i) => [
    (i * w) / (prices.length - 1),
    h - ((p - low) / (high - low)) * h,
  ]);
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const active =
    point == null ? bars.length - 1 : Math.min(point, bars.length - 1);
  return (
    <div className="chart-wrap">
      <div className="chart-periods" aria-label="图表时间范围">
        {[
          [5, "近5日"],
          [20, "近20日"],
          [65, stock?.demo === false ? "全部日线" : "全部样例"],
        ].map(([n, label]) => (
          <button
            key={n}
            className={range === n ? "selected" : ""}
            aria-pressed={range === n}
            onClick={() => {
              setRange(Number(n));
              setPoint(null);
            }}
          >
            {label}
          </button>
        ))}
        <span>移动鼠标 / 拖动下方滑杆查看逐日价格</span>
      </div>
      <div className="chart-caption">
        <strong>
          {stock?.symbol} <span>{stock?.name}</span>
        </strong>
        <span>
          {stock?.demo === false
            ? bars[active].timestamp.slice(0, 10)
            : date(bars[active].timestamp)}{" "}
          · {amount(bars[active].close, stock?.currency)}
        </span>
      </div>
      <div className="chart-grid">
        <div className="chart-labels">
          {[high, (high + low) / 2, low].map((v) => (
            <span key={v}>{amount(v, "", 0)}</span>
          ))}
        </div>
        <svg
          role="img"
          aria-label={`${stock?.name}${stock?.demo === false ? "真实日线" : "虚构历史价格"}走势图`}
          viewBox={`-2 -5 ${w + 4} ${h + 10}`}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setPoint(
              Math.min(
                bars.length - 1,
                Math.max(
                  0,
                  Math.round(
                    ((e.clientX - rect.left) / rect.width) * (bars.length - 1),
                  ),
                ),
              ),
            );
          }}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setPoint(
              Math.min(
                bars.length - 1,
                Math.max(
                  0,
                  Math.round(
                    ((e.clientX - rect.left) / rect.width) * (bars.length - 1),
                  ),
                ),
              ),
            );
          }}
          onPointerLeave={() => setPoint(null)}
        >
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#278a74" stopOpacity=".19" />
              <stop offset="100%" stopColor="#278a74" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, h / 2, h].map((y) => (
            <line
              key={y}
              x1="0"
              x2={w}
              y1={y}
              y2={y}
              stroke="#e7eceb"
              strokeDasharray="4 5"
            />
          ))}
          <polygon points={`0,${h} ${line} ${w},${h}`} fill="url(#area)" />
          <polyline
            points={line}
            fill="none"
            stroke="#298770"
            strokeWidth="2.5"
          />
          {point != null && (
            <>
              <line
                x1={coords[active][0]}
                x2={coords[active][0]}
                y1="0"
                y2={h}
                stroke="#8caba1"
                strokeDasharray="3 4"
              />
              <circle
                cx={coords[active][0]}
                cy={coords[active][1]}
                r="5"
                fill="#247a64"
                stroke="white"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
      </div>
      <div className="chart-dates">
        <span>{bars[0].timestamp.slice(0, 10)}</span>
        <span>
          {bars.length} 个
          {stock?.demo === false ? "供应商交易日" : "虚构工作日"} ·
          非账户收益曲线
        </span>
        <span>{bars.at(-1)?.timestamp.slice(0, 10)}</span>
      </div>
      <input
        className="chart-slider"
        aria-label="选择历史交易日"
        type="range"
        min="0"
        max={bars.length - 1}
        value={active}
        onChange={(e) => setPoint(Number(e.target.value))}
      />
    </div>
  );
}

function PositionTable({
  positions,
  onSelect,
}: {
  positions: Position[];
  onSelect?: (symbol: string) => void;
}) {
  if (!positions.length)
    return <Empty text="当前视图暂无持仓，请录入交易或切换账户。" />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>股票 / 市场</th>
            <th>持有股数</th>
            <th>平均成本 / 现价</th>
            <th>持仓市值</th>
            <th>未实现盈亏</th>
            <th>组合仓位</th>
            <th>{onSelect ? "分析" : "持仓类型"}</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={`${p.account_id}-${p.symbol}`}>
              <td>
                <div className="stock-cell">
                  <span
                    className={`stock-logo ${p.market === "CN" ? "cn" : ""}`}
                  >
                    {p.symbol.slice(0, 2)}
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.symbol}{" "}
                      <span className="market-tag">
                        {p.market === "US" ? "美股" : "A 股"} · {p.currency}
                      </span>
                    </small>
                  </div>
                </div>
              </td>
              <td>{amount(p.quantity, "", 0)}</td>
              <td>
                <span>{amount(p.average_cost, p.currency)}</span>
                <small>
                  {amount(p.price, p.currency)}{" "}
                  <span className="amber-text">
                    {p.price === null
                      ? "待报价"
                      : p.demo === false
                        ? "日线缓存"
                        : "样例"}
                  </span>
                </small>
              </td>
              <td title={`${p.source} · ${p.provenance?.delay || ""}`}>
                {amount(p.market_value, p.currency)}
                {p.demo === false && (
                  <small>
                    {p.provenance?.as_of_date || "报价日期缺失"}
                    {p.provenance?.error ? " · 更新失败" : " · 非实时"}
                  </small>
                )}
              </td>
              <td className={tone(p.unrealized)}>
                <strong>{amount(p.unrealized, p.currency)}</strong>
                <small>{percent(p.return_pct)}</small>
              </td>
              <td>
                <span>{percent(p.weight)}</span>
                <div className="tiny-bar">
                  <i
                    style={{
                      width: `${Math.min(Number(p.weight) * 100, 100)}%`,
                    }}
                  />
                </div>
              </td>
              <td>
                {onSelect ? (
                  <button
                    className="icon-button"
                    title={`分析${p.name}`}
                    onClick={() => onSelect(p.symbol)}
                  >
                    <ArrowUpRight size={17} />
                  </button>
                ) : (
                  <Badge kind="green">虚拟持仓</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({
  data,
  stock,
  choose,
  navigate,
  diagnose,
}: {
  data: Data;
  stock: Stock | null;
  choose: (s: string) => void;
  navigate: (p: number) => void;
  diagnose: (s: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const p = data.portfolio;
  const real = data.feed?.mode === "real";
  const total = p.accounts.length === 1 ? p.accounts[0] : p.combined;
  const currency = total.currency;
  // Only turn existing portfolio and risk-policy data into explainable observations.
  const highAlerts = data.risk.alerts.filter((alert) => alert.level === "high");
  const keyAlert = highAlerts[0] || data.risk.alerts[0];
  const equity = total.equity === null ? null : Number(total.equity);
  const cashRatio =
    equity !== null && Number.isFinite(equity) && equity > 0 && total.cash !== null
      ? Number(total.cash) / equity
      : null;
  const cashFloor = Number(data.risk.policy.cash_floor);
  const sectorLimit = Number(data.risk.policy.sector_limit);
  const largestSector = Object.entries(data.risk.sectors).sort(
    (a, b) => Number(b[1]) - Number(a[1]),
  )[0];
  const allocationValid = cashRatio !== null && Number.isFinite(cashRatio);
  const allocationNotes = [
    !allocationValid
      ? {
          title: "先核对资产估值",
          detail: "报价或汇率缺失，现金占比及完整配置暂不可计算；请先核对数据来源。",
          page: 6,
        }
      : cashRatio < cashFloor
        ? {
            title: "检查现金缓冲",
            detail: `现金占比 ${percent(cashRatio)}，低于当前规则底线 ${percent(cashFloor)}；先评估流动性需求与风险预算。`,
            page: 5,
          }
        : {
            title: "现金缓冲符合规则",
            detail: `现金占比 ${percent(cashRatio)}，当前规则底线为 ${percent(cashFloor)}；仍需结合个人资金需求复核。`,
            page: 5,
          },
    !allocationValid || !largestSector
      ? {
          title: "行业分布有待确认",
          detail: "完整估值不足，暂不判断行业集中度；可先切换单账户查看。",
          page: 1,
        }
      : Number(largestSector[1]) > sectorLimit
        ? {
            title: "关注行业集中度",
            detail: `${largestSector[0]}占比 ${percent(largestSector[1])}，超过规则上限 ${percent(sectorLimit)}；可核查敞口是否符合预设约束。`,
            page: 5,
          }
        : {
            title: "复核最大行业敞口",
            detail: `${largestSector[0]}占比 ${percent(largestSector[1])}，规则上限 ${percent(sectorLimit)}；当前未见这一项超限。`,
            page: 5,
          },
    highAlerts.length
      ? {
          title: "优先复核高优先级风险",
          detail: `目前有 ${highAlerts.length} 项高优先级提醒；请先核查规则和行情时效，再评估任何调仓方案。`,
          page: 5,
        }
      : data.risk.alerts.length
        ? {
            title: "核对风险提醒",
            detail: `当前有 ${data.risk.alerts.length} 项提醒，可能包含数据时效或汇率提示；暂无高优先级不代表没有风险。`,
            page: 5,
          }
        : {
            title: "定期复查风险约束",
            detail: "当前没有触发规则提醒；这不代表风险为零，仍需检查行情时效和个人承受能力。",
            page: 5,
          },
  ];
  const colors = ["#237861", "#68ab94", "#a1c6b6", "#d8bc77"];
  let cumulative = 0;
  const slices = Object.values(data.risk.sectors).map((weight, i) => {
    const start = cumulative;
    cumulative += Number(weight) * 100;
    return `${colors[i % colors.length]} ${start}% ${cumulative}%`;
  });
  slices.push(`#dce5e0 ${cumulative}% 100%`);
  return (
    <>
      <section className="welcome">
        <div>
          <div className="eyebrow">AI STOCKPILOT</div>
          <h2>投资，一目了然。</h2>
          <p>
            {real
              ? "真实报价，清楚来源。资产、收益与风险，都在这里。"
              : "演示账本与虚构价格已明确标识；可在设置中切换真实行情。"}
          </p>
        </div>
        <div className="welcome-mark">
          <Activity size={48} />
          <span>INVEST WITH CLARITY</span>
        </div>
      </section>
      <div className="stat-grid overview-priority-grid">
        <article className="stat primary overview-profit">
          <div>
            当前收益状况 <Activity size={17} />
          </div>
          <h2 className={tone(total.total_pnl)}>
            {amount(total.total_pnl, currency)}
          </h2>
          <p className="overview-large-percent">
            <strong className={tone(total.return_pct)}>{percent(total.return_pct)}</strong>
            <span>累计收益率 · 已实现 + 未实现</span>
          </p>
          <small>
            {real ? "按可用的真实日线估值，非盘中实时收益" : "虚构样例收益，并非真实账户业绩"}
          </small>
        </article>
        <article className="stat overview-risk">
          <div>
            风险评估 <Shield size={17} />
          </div>
          <h2>{highAlerts.length} <span className="unit">项高优先级</span></h2>
          <p className={highAlerts.length ? "overview-risk-warning" : ""}>
            {data.risk.alerts.length} 项规则提醒
          </p>
          <small>{keyAlert ? `${keyAlert.symbol}：${keyAlert.message}` : "当前没有触发提醒，不代表无风险"}</small>
          <button type="button" className="text-button overview-inline-action" onClick={() => navigate(5)}>
            查看风险详情 <ArrowRight size={13} />
          </button>
        </article>
        <article className="stat overview-allocation">
          <div>
            资金配置观察 <Wallet size={17} />
          </div>
          <h2 className={allocationValid && cashRatio < cashFloor ? "overview-risk-warning" : ""}>
            {allocationValid ? percent(cashRatio) : "暂不可计算"}
          </h2>
          <p>当前现金占比 · 规则底线 <strong>{percent(cashFloor)}</strong></p>
          <div
            className="overview-cash-track"
            role="img"
            aria-label={allocationValid ? `现金占比 ${percent(cashRatio)}，规则底线 ${percent(cashFloor)}` : "暂无可用现金占比"}
          >
            {allocationValid && <span style={{ width: `${Math.max(0, Math.min(100, cashRatio * 100))}%` }} />}
            <i style={{ left: `${Math.max(0, Math.min(100, cashFloor * 100))}%` }} />
          </div>
          <small>{allocationValid ? "进度条显示现金占比，刻度为现有现金下限" : "报价或汇率可能缺失，请查看数据设置"}</small>
        </article>
        <article className={`stat ${showDetails ? "" : "dashboard-stat-hidden"}`}>
          <div>总资产 <Wallet size={17} /></div>
          <h2>{amount(total.equity, currency)}</h2>
          <p>{p.accounts.length === 1 ? "所选账户 · 原币" : real ? "CNY 合并 · 需真实汇率" : "CNY 合并 · 使用演示汇率"} · 含现金与股票市值</p>
        </article>
        <article className={`stat ${showDetails ? "" : "dashboard-stat-hidden"}`}>
          <div>今日盈亏 <Activity size={17} /></div>
          <h2 className={total.today_pnl === null ? "unavailable" : tone(total.today_pnl)}>
            {total.today_pnl === null ? real ? "盘中收益暂不计算" : "暂无今日行情" : amount(total.today_pnl, currency)}
          </h2>
          <p>{real ? "最近参考交易日" : "最近样例交易日"} <strong>{amount(total.latest_session_pnl, currency)}</strong></p>
          <small>{total.latest_session_date || "暂无日期"} · 不冒充今日行情</small>
        </article>
        <article className={`stat ${showDetails ? "" : "dashboard-stat-hidden"}`}>
          <div>未实现盈亏 <Activity size={17} /></div>
          <h2 className={tone(total.unrealized)}>{amount(total.unrealized, currency)}</h2>
          <p>已实现收益 <strong>{amount(total.realized, currency)}</strong></p>
        </article>
        <article className={`stat ${showDetails ? "" : "dashboard-stat-hidden"}`}>
          <div>可用现金 <ArrowDownLeft size={17} /></div>
          <h2>{amount(total.cash, currency)}</h2>
          <p>资金安排需参考现金下限和个人约束</p>
        </article>
      </div>
      <button
        type="button"
        className="dashboard-more-button"
        aria-expanded={showDetails}
        onClick={() => setShowDetails((current) => !current)}
      >
        {showDetails ? "收起收益与资产明细" : "展开总资产、今日盈亏与现金明细"}
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <section className="panel overview-advice" aria-label="配置观察与行动参考">
        <div className="panel-heading">
          <div>
            <h3>配置观察与行动参考 <Badge kind="green">规则分析</Badge></h3>
            <p>基于当前持仓、现金下限和风险预警生成；用于复核，不是自动买卖指令。</p>
          </div>
          <button className="text-button" onClick={() => navigate(5)}>
            风险规则 <ArrowRight size={14} />
          </button>
        </div>
        <div className="overview-advice-list">
          {allocationNotes.map((note, index) => (
            <article key={note.title} className="overview-advice-item">
              <span className="overview-advice-index" aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{note.title}</strong>
                <p>{note.detail}</p>
              </div>
              <button type="button" className="text-button" onClick={() => navigate(note.page)}>
                查看依据 <ArrowRight size={13} />
              </button>
            </article>
          ))}
        </div>
        <p className="overview-advice-footnote">
          {real
            ? "行情可能延迟、缺失，账户仍可能含演示持仓；核实资产数据后再评估实际决策。"
            : "目前使用虚构演示行情和账本，展示的是规则如何分析，并非对真实投资组合的个性化建议。"}
        </p>
      </section>
      <div className="dashboard-grid">
        {real ? (
          <EquityChart revision={data.portfolio.as_of} />
        ) : (
          <>
            <section className="panel price-panel">
              <div className="panel-heading">
                <div>
                  <h3>
                    市场走势 <Badge>演示行情</Badge>
                  </h3>
                  <p>历史价格样例，帮助研究持仓波动</p>
                </div>
                <select
                  aria-label="走势股票"
                  value={stock?.symbol || "AAPL"}
                  onChange={(e) => choose(e.target.value)}
                >
                  {data.market.map((m) => (
                    <option key={m.symbol} value={m.symbol}>
                      {m.symbol} · {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <PriceChart stock={stock} />
              <Source
                timestamp={stock?.timestamp || null}
                source={stock?.source}
                provenance={stock?.provenance}
              />
            </section>
          </>
        )}
        <section className="panel allocation">
          <div className="panel-heading">
            <div>
              <h3>资产配置</h3>
              <p>按账户原币核算；合并占比需同模式的可用汇率</p>
            </div>
            <Globe2 size={18} />
          </div>
          {total.equity === null ? (
            <Empty text="部分报价或汇率缺失，无法计算完整持仓分布。可切换单账户查看。" />
          ) : (
            <>
              <div
                className="allocation-symbol"
                role="img"
                aria-label="按实际演示敞口计算的资产配置"
                style={{ background: `conic-gradient(${slices.join(",")})` }}
              >
                <div>
                  <Globe2 size={32} />
                  <strong>
                    {p.positions.length}
                    <small>持仓标的</small>
                  </strong>
                </div>
              </div>
              <div className="alloc-list">
                {Object.entries(data.risk.sectors).map(
                  ([sector, weight], i) => (
                    <div key={sector}>
                      <span>
                        <i
                          style={{
                            background: [
                              "#237861",
                              "#68ab94",
                              "#a1c6b6",
                              "#d8bc77",
                            ][i % 4],
                          }}
                        />
                        {sector}
                      </span>
                      <strong>{percent(weight)}</strong>
                      <div className="allocation-meter" aria-hidden="true">
                        <span style={{ width: `${Math.max(0, Math.min(100, Number(weight) * 100))}%` }} />
                      </div>
                    </div>
                  ),
                )}
                <div>
                  <span>
                    <i style={{ background: "#dce5e0" }} />
                    现金与其他
                  </span>
                  <strong>
                    {total.equity && total.cash
                      ? percent(Number(total.cash) / Number(total.equity))
                      : "暂无数据"}
                  </strong>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      <div className="home-shortcuts">
        <button onClick={() => navigate(1)}>
          <Wallet size={20} />
          <strong>美股与 A 股持仓</strong>
          <small>
            {p.positions.filter((x) => x.market === "US").length} 只美股 ·{" "}
            {p.positions.filter((x) => x.market === "CN").length} 只 A 股
          </small>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => navigate(3)}>
          <Star size={20} />
          <strong>股票观察池</strong>
          <small>{data.watchlist.length} 个收藏 · 点击查看研究</small>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => navigate(4)}>
          <FlaskConical size={20} />
          <strong>模拟交易</strong>
          <small>虚拟资金 · 无实盘连接</small>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => navigate(2)}>
          <BookOpen size={20} />
          <strong>分析报告</strong>
          <small>日报 / 周报快照与下载</small>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="home-risk-summary">
        <Shield size={18} />
        <strong>风险预警</strong>
        <span>
          {data.risk.alerts
            .slice(0, 2)
            .map((x) => `${x.symbol}：${x.message}`)
            .join("；") || "暂无触发，不代表无风险"}
        </span>
        <button className="text-button" onClick={() => navigate(5)}>
          查看全部 <ArrowRight size={14} />
        </button>
      </div>
      <div className="insight-banner">
        <span className="insight-icon">
          <Sparkles size={21} />
        </span>
        <div>
          <strong>
            持仓洞察，让风险看得见 <Badge kind="green">规则分析</Badge>
          </strong>
          <p>
            {
              data.risk.diagnostics.filter((d) => Number(d.unrealized) < 0)
                .length
            }{" "}
            只持仓出现账面亏损。比较不同情景与风险预算，避免情绪化补仓。
          </p>
        </div>
        <button className="outline-button" onClick={() => navigate(2)}>
          查看持仓诊断 <ArrowRight size={15} />
        </button>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>
              当前持仓 <span className="count">{p.positions.length}</span>
            </h3>
            <p>移动平均成本 · 买入手续费计入成本 · 报价来源按当前模式标注</p>
          </div>
          <button className="text-button" onClick={() => navigate(1)}>
            全部持仓 <ChevronRight size={15} />
          </button>
        </div>
        <PositionTable positions={p.positions} onSelect={diagnose} />
      </section>
      {p.fx && (
        <p className="source">
          合并换算：1 USD = {p.fx.rate} CNY · {p.fx.source} ·{" "}
          {p.fx.provenance?.timestamp_precision === "date"
            ? `${p.fx.timestamp.slice(0, 10)}（央行参考日期，非逐笔报价时间）`
            : `${date(p.fx.timestamp)}（上海）`}
          {p.fx.stale && " · 汇率已过期，请核对参考日期"}
        </p>
      )}
    </>
  );
}

function Holdings({
  data,
  diagnose,
  add,
}: {
  data: Data;
  diagnose: (s: string) => void;
  add: () => void;
}) {
  const [q, setQ] = useState(""),
    [market, setMarket] = useState(""),
    [sort, setSort] = useState("weight");
  const positions = data.portfolio.positions
    .filter(
      (p) =>
        (p.symbol + p.name).toLowerCase().includes(q.toLowerCase()) &&
        (!market || p.market === market),
    )
    .sort((a, b) =>
      sort === "weight"
        ? Number(b.weight) - Number(a.weight)
        : Number(a.return_pct) - Number(b.return_pct),
    );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>我的持仓</h3>
          <p>按账户隔离核算，选择股票查看成本及诊断</p>
        </div>
        <button className="button" onClick={add}>
          <Plus size={16} />
          录入交易
        </button>
      </div>
      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="搜索持仓"
            placeholder="搜索代码或名称"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          aria-label="持仓市场"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
        >
          <option value="">全部市场</option>
          <option value="US">美股</option>
          <option value="CN">A 股</option>
        </select>
        <select
          aria-label="持仓排序"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="weight">仓位从高到低</option>
          <option value="return">收益率从低到高</option>
        </select>
        <ListFilter size={17} />
      </div>
      <PositionTable positions={positions} onSelect={diagnose} />
    </section>
  );
}

function Diagnosis({
  data,
  selected,
  setSelected,
  act,
  busy,
}: {
  data: Data;
  selected: string;
  setSelected: (s: string) => void;
  act: Action;
  busy: boolean;
}) {
  const d =
    data.risk.diagnostics.find((x) => x.symbol === selected) ||
    data.risk.diagnostics[0];
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>
              <Sparkles size={19} /> 持仓诊断
            </h3>
            <p>规则型解释分析 · 未调用大语言模型 · 无确定性买卖指令</p>
          </div>
          <select
            aria-label="诊断股票"
            value={d?.symbol || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {data.risk.diagnostics.map((p) => (
              <option key={`${p.account_id}-${p.symbol}`} value={p.symbol}>
                {p.name} · {p.symbol}
              </option>
            ))}
          </select>
        </div>
        {d ? (
          <div className="diagnosis-body">
            <div className="diagnosis-title">
              <span className="stock-logo big">{d.symbol.slice(0, 2)}</span>
              <div>
                <h2>
                  {d.name} <small>{d.symbol}</small>
                </h2>
                <Source
                  timestamp={d.timestamp}
                  source={d.source}
                  provenance={d.provenance}
                />
              </div>
              <Badge kind={d.risk_score >= 50 ? "red" : "amber"}>
                {d.status} · {d.risk_score} 分
              </Badge>
            </div>
            <div className="metric-grid">
              <div>
                未实现盈亏
                <strong className={tone(d.unrealized)}>
                  {amount(d.unrealized, d.currency)}
                </strong>
                <small>{percent(d.return_pct)}</small>
              </div>
              <div>
                平均成本<strong>{amount(d.average_cost, d.currency)}</strong>
                <small>含买入手续费</small>
              </div>
              <div>
                年化波动<strong>{percent(d.metrics.volatility)}</strong>
                <small>样本对数收益标准差 × √252</small>
              </div>
              <div>
                历史最大回撤<strong>{percent(d.metrics.drawdown)}</strong>
                <small>样本价格 / 历史高点 − 1</small>
              </div>
            </div>
            <div className="notice amber">
              <Shield size={18} />
              <div>
                <strong>风险触发与推导</strong>
                <p>
                  {d.reasons.length
                    ? d.reasons.join("；")
                    : "当前未触发已配置的量化阈值，仍需复核演示数据。"}
                </p>
              </div>
            </div>
            <details>
              <summary>查看评分公式与计算口径</summary>
              <p>{d.formula}</p>
              <p>
                股票盈亏贡献（人民币演示折算）：
                {amount(d.contribution_cny, "CNY")}；仓位 {percent(d.weight)}。
              </p>
            </details>
            <h3 className="section-label">
              亏损情景对比 <Badge>假设模拟，非预测</Badge>
            </h3>
            {d.scenarios.length ? (
              <div className="scenario-grid">
                {d.scenarios.map((s) => (
                  <article key={s.name}>
                    <h4>{s.name}</h4>
                    <p>评估卖出 {amount(s.quantity, "", 0)} 股</p>
                    <dl>
                      <dt>交易费用</dt>
                      <dd>{amount(s.fees, d.currency)}</dd>
                      <dt>滑点成本</dt>
                      <dd>{amount(s.slippage_cost, d.currency)}</dd>
                      <dt>余仓上涨 10% 后变化</dt>
                      <dd className="positive">
                        {amount(s.up_10_gain, d.currency)}
                      </dd>
                      <dt>余仓下跌 10% 后变化</dt>
                      <dd className="negative">
                        {amount(s.down_10_loss, d.currency)}
                      </dd>
                    </dl>
                    <small>
                      {s.assumption}。{s.trigger}。
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                text={
                  d.unrealized === null
                    ? "缺少可用报价，不能判断收益或生成亏损情景。"
                    : "此持仓当前没有账面亏损，暂无亏损情景。"
                }
              />
            )}
            <p className="muted">{d.risk_note}</p>
          </div>
        ) : (
          <Empty />
        )}
      </section>
      <Reports data={data} act={act} busy={busy} />
    </>
  );
}

function Research({
  data,
  stock,
  choose,
  act,
}: {
  data: Data;
  stock: Stock | null;
  choose: (s: string) => void;
  act: Action;
}) {
  const [q, setQ] = useState(""),
    [market, setMarket] = useState(""),
    [only, setOnly] = useState(false),
    [sort, setSort] = useState("score");
  const stocks = data.market
    .filter(
      (s) =>
        (s.name + s.symbol).toLowerCase().includes(q.toLowerCase()) &&
        (!market || s.market === market) &&
        (!only || data.watchlist.includes(s.symbol)),
    )
    .sort((a, b) =>
      sort === "score"
        ? Number(b.metrics.score) - Number(a.metrics.score)
        : Number(a.metrics.volatility) - Number(b.metrics.volatility),
    );
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>股票研究与观察池</h3>
            <p>6 个内置标的 · 来源与更新时间逐项标注 · 评分不构成买入保证</p>
          </div>
          <button
            className={`outline-button ${only ? "selected" : ""}`}
            onClick={() => setOnly(!only)}
          >
            <Star size={15} />
            {only ? "我的观察池" : "全部股票"}
          </button>
        </div>
        <div className="toolbar">
          <label className="search">
            <Search size={16} />
            <input
              placeholder="搜索股票"
              aria-label="搜索股票"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select
            aria-label="研究市场"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
          >
            <option value="">全部市场</option>
            <option value="US">美股</option>
            <option value="CN">A 股</option>
          </select>
          <select
            aria-label="研究排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="score">多指标评分降序</option>
            <option value="volatility">波动率升序</option>
          </select>
        </div>
        <div className="stock-grid">
          {stocks.length ? (
            stocks.map((s) => (
              <article
                key={s.symbol}
                className={stock?.symbol === s.symbol ? "active-stock" : ""}
              >
                <div>
                  <button
                    className="stock-link"
                    onClick={() => choose(s.symbol)}
                  >
                    <strong>{s.name}</strong>
                    <small>
                      {s.symbol} · {s.market === "US" ? "美股" : "A 股"}
                    </small>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${data.watchlist.includes(s.symbol) ? "取消" : "添加"}收藏${s.name}`}
                    onClick={() =>
                      void act(
                        () =>
                          api(
                            `/watchlist/${s.symbol}`,
                            data.watchlist.includes(s.symbol)
                              ? "DELETE"
                              : "PUT",
                          ),
                        "观察池已更新",
                      )
                    }
                  >
                    <Star
                      size={18}
                      fill={
                        data.watchlist.includes(s.symbol) ? "#d8b76e" : "none"
                      }
                      color="#ad8a44"
                    />
                  </button>
                </div>
                <h3>
                  {amount(s.price, s.currency)}{" "}
                  <Badge kind="amber">
                    {s.price === null
                      ? "报价缺失"
                      : s.demo === false
                        ? "真实日线"
                        : "虚构样例"}
                  </Badge>
                </h3>
                <div className="stock-metrics">
                  <span>
                    研究评分 <strong>{s.metrics.score ?? "—"}</strong>
                  </span>
                  <span>
                    RSI14 <strong>{s.metrics.rsi14?.toFixed(1) ?? "—"}</strong>
                  </span>
                </div>
              </article>
            ))
          ) : (
            <Empty text="没有符合条件的股票。" />
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>
              {stock?.name || "股票详情"} ·{" "}
              {stock?.demo === false ? "真实日线" : "历史样例"}
            </h3>
            <p>
              最新日成交量 {amount(stock?.bars?.at(-1)?.volume, "", 0)} 股 ·
              估值及财报日期暂无授权数据
            </p>
          </div>
          <Badge kind="amber">非实时</Badge>
        </div>
        <div className="pad">
          <PriceChart stock={stock} />
          <div className="metric-grid">
            <div>
              MA20
              <strong>{amount(stock?.metrics.ma20, stock?.currency)}</strong>
            </div>
            <div>
              RSI14
              <strong>{stock?.metrics.rsi14?.toFixed(2) || "暂无数据"}</strong>
            </div>
            <div>
              年化波动<strong>{percent(stock?.metrics.volatility)}</strong>
            </div>
            <div>
              最大回撤<strong>{percent(stock?.metrics.drawdown)}</strong>
            </div>
          </div>
          <p>{stock?.score_formula}</p>
          <details>
            <summary>指标公式、数据缺口与限制</summary>
            <p>
              MA20=最近20收盘算术平均；RSI14 使用14期简单平均涨跌比（非 Wilder
              平滑）；波动率=日对数收益样本标准差×√252；回撤=价格/此前最高价−1。
            </p>
            <p>{stock?.limitations}</p>
            <p>排序可切换评分或波动率；暂不支持自定义评分权重。</p>
          </details>
          <Source
            timestamp={stock?.timestamp || null}
            source={stock?.source}
            provenance={stock?.provenance}
          />
        </div>
      </section>
    </>
  );
}

function PaperTrading({
  data,
  act,
  busy,
}: {
  data: Data;
  act: Action;
  busy: boolean;
}) {
  const [account, setAccount] = useState("3"),
    [symbol, setSymbol] = useState("AAPL"),
    [side, setSide] = useState("buy"),
    [quantity, setQuantity] = useState("10"),
    [note, setNote] = useState(""),
    [demo, setDemo] = useState(false);
  const currency = data.accounts.find(
    (a) => a.id === Number(account),
  )?.currency;
  const options = data.market.filter((s) => s.currency === currency);
  return (
    <>
      <div className="notice green">
        <ShieldCheck size={21} />
        <div>
          <strong>隔离的虚拟资金账户 · 实盘交易未实现</strong>
          <p>
            订单仅写入本地模拟账本，没有券商连接。模拟模块使用独立、明确标注的虚构成交样例，和真实行情估值隔离。待成交订单不冻结资金，执行时串行复核。
          </p>
        </div>
      </div>
      <div className="two-col">
        {data.paper.accounts.map((a) => (
          <article key={a.id} className="stat">
            <div>
              {a.name}
              <Badge kind="green">虚拟</Badge>
            </div>
            <h2>{amount(a.equity, a.currency)}</h2>
            <p>
              可用 {amount(a.cash, a.currency)}{" "}
              <span>已实现 {amount(a.realized, a.currency)}</span>
            </p>
          </article>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>创建模拟交易计划</h3>
            <p>创建后手动确认模拟成交，或撤销待成交订单</p>
          </div>
          <FlaskConical size={20} />
        </div>
        <form
          className="pad"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                api("/paper-orders", "POST", {
                  account_id: Number(account),
                  symbol,
                  side,
                  quantity,
                  note,
                }),
              "模拟订单已创建，尚未成交",
            );
          }}
        >
          <div className="form-grid">
            <label>
              虚拟账户
              <select
                value={account}
                onChange={(e) => {
                  const a = e.target.value;
                  setAccount(a);
                  setSymbol(a === "3" ? "AAPL" : "600036");
                  setQuantity(a === "3" ? "10" : "100");
                }}
              >
                {data.accounts
                  .filter((a) => a.paper)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              交易标的
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              >
                {options.map((s) => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.name} · {s.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label>
              方向
              <select
                aria-label="模拟方向"
                value={side}
                onChange={(e) => setSide(e.target.value)}
              >
                <option value="buy">模拟买入</option>
                <option value="sell">模拟卖出</option>
              </select>
            </label>
            <label>
              股数
              <input
                required
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
          </div>
          <label className="block-label">
            交易计划 / 复盘备注
            <input
              maxLength={500}
              placeholder="记录研究假设、止损条件与复盘要点"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy}>
            <Plus size={16} />
            创建模拟订单
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>模拟订单与执行记录</h3>
            <p>模拟费率、滑点及规则可在设置页查看和调整</p>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={demo}
              onChange={(e) => setDemo(e.target.checked)}
            />
            我确认使用历史演示时钟成交
          </label>
        </div>
        {demo && (
          <div className="notice amber inset">
            <CircleHelp size={18} />
            <span>
              每只股票固定使用最后一根样例行情的历史时点；A 股同日买入仍受 T+1
              限制。此模式不验证真实市场是否开市。
            </span>
          </div>
        )}
        {data.orders.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>订单 / 标的</th>
                  <th>方向 / 股数</th>
                  <th>状态</th>
                  <th>成交价 / 费用</th>
                  <th>说明与计划</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>
                        #{o.id} · {o.symbol}
                      </strong>
                      <small>{date(o.created_at)} 创建（上海）</small>
                      <small>
                        {o.executed_at && `${date(o.executed_at)} 成交（上海）`}
                      </small>
                    </td>
                    <td>
                      {o.side === "buy" ? "买入" : "卖出"}{" "}
                      {amount(o.quantity, "", 0)}
                    </td>
                    <td>
                      <Badge
                        kind={
                          o.status === "filled"
                            ? "green"
                            : o.status === "rejected"
                              ? "red"
                              : ""
                        }
                      >
                        {status[o.status]}
                      </Badge>
                    </td>
                    <td>
                      {amount(
                        o.fill_price,
                        data.accounts.find((a) => a.id === o.account_id)
                          ?.currency,
                      )}
                      <small>费用 {amount(o.fee)}</small>
                    </td>
                    <td className="wrap-cell">
                      {o.reason || "等待手动执行"}
                      <small>{o.note}</small>
                    </td>
                    <td>
                      {o.status === "pending" && (
                        <div className="row-actions">
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                const result = await api<Order>(
                                  `/paper-orders/${o.id}/fill`,
                                  "POST",
                                  { demo_clock: demo },
                                );
                                if (result.status === "rejected")
                                  throw new Error(
                                    `订单已拒绝：${result.reason}`,
                                  );
                              }, "模拟成交已写入账本")
                            }
                          >
                            模拟成交
                          </button>
                          <button
                            className="text-button muted"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () =>
                                  api(`/paper-orders/${o.id}/cancel`, "POST"),
                                "订单已撤销",
                              )
                            }
                          >
                            撤单
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="尚无模拟订单。建议用美元虚拟账户完成一次 10 股买入和卖出，体验费用与盈亏。" />
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>虚拟账户持仓</h3>
            <p>
              {isOffline
                ? "成交更新本机浏览器虚拟账本，支持导出"
                : "成交更新本地 SQLite 虚拟账本，刷新后保留"}
            </p>
          </div>
        </div>
        <PositionTable positions={data.paper.positions} />
      </section>
      <Reports data={data} act={act} busy={busy} review />
    </>
  );
}

function RiskCenter({
  data,
  act,
  busy,
}: {
  data: Data;
  act: Action;
  busy: boolean;
}) {
  const [policy, setPolicy] = useState<Policy>(data.policy);
  const fields: { key: keyof Policy; label: string }[] = [
    { key: "single_limit", label: "单股仓位上限 (%)" },
    { key: "sector_limit", label: "行业敞口上限 (%)" },
    { key: "max_loss", label: "持仓亏损承受阈值 (%)" },
    { key: "cash_floor", label: "现金比例底线 (%)" },
    { key: "order_limit", label: "单笔模拟金额上限（账户原币）" },
  ];
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>风险预算与纪律</h3>
            <p>
              持仓比例和亏损阈值用于分析预警；现金底线与金额上限会阻止模拟买入 /
              交易
            </p>
          </div>
          <ShieldCheck size={20} />
        </div>
        <form
          className="pad"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api("/risk-policy", "PUT", policy),
              "风控规则已保存",
            );
          }}
        >
          <div className="form-grid">
            {fields.map(({ key, label }) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  type="number"
                  required
                  min={key === "cash_floor" ? 0 : 0.01}
                  max={key === "order_limit" ? 1000000000 : 100}
                  step="0.01"
                  value={
                    key === "order_limit"
                      ? policy[key]
                      : Number((Number(policy[key]) * 100).toFixed(6))
                  }
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      [key]:
                        key === "order_limit"
                          ? e.target.value
                          : String(Number(e.target.value) / 100),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <button className="button" disabled={busy}>
            <Check size={16} />
            保存风险规则
          </button>
        </form>
      </section>
      <div className="two-col align-start">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>
                风险预警{" "}
                <span className="count">{data.risk.alerts.length}</span>
              </h3>
              <p>同日收盘涨跌不等同于开盘跳空；无开盘数据时不虚构跳空指标</p>
            </div>
          </div>
          <div className="alert-list">
            {data.risk.alerts.length ? (
              data.risk.alerts.map((a, i) => (
                <div key={i}>
                  <span className={`alert-dot ${a.level}`} />
                  <div>
                    <strong>{a.symbol}</strong>
                    <p>{a.message}</p>
                  </div>
                  <Badge kind={a.level === "high" ? "red" : "amber"}>
                    {a.level === "high" ? "风险偏高" : "需复核"}
                  </Badge>
                </div>
              ))
            ) : (
              <Empty text="未触发当前规则，不代表没有风险。" />
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>情景压力测试</h3>
              <p>假设模拟 · 结果以 CNY 演示折算</p>
            </div>
          </div>
          <div className="pad">
            {data.risk.stress.map((s) => (
              <div className="stress" key={s.name}>
                <span>{s.name}</span>
                <strong className="negative">
                  {amount(s.change_cny, "CNY")}
                </strong>
              </div>
            ))}
            <p className="muted">{data.risk.stress_note}</p>
            <details>
              <summary>预警和执行限制的范围</summary>
              <p>
                单股/行业上限不阻止卖出或历史成交录入。模拟买入强制检查现金底线，买卖均检查单笔金额和可成交规则。规则不替代投资者适当性评估。
              </p>
            </details>
          </div>
        </section>
      </div>
    </>
  );
}

function Reports({
  data,
  act,
  busy,
  review = false,
}: {
  data: Data;
  act: Action;
  busy: boolean;
  review?: boolean;
}) {
  const [kind, setKind] = useState(review ? "review" : "daily");
  const download = (report: SavedReport) => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { ...report, payload: JSON.parse(report.payload) },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `stockpilot-report-${report.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>{review ? "模拟交易复盘与报告" : "分析报告档案"}</h3>
          <p>
            生成时点快照，记录组合、风险与模拟账户；不冒充期间收益或基准回测
          </p>
        </div>
        <div className="inline-controls">
          <select
            aria-label="报告类型"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="daily">持仓日报快照</option>
            <option value="weekly">持仓周报快照</option>
            <option value="review">模拟交易复盘</option>
          </select>
          <button
            className="outline-button"
            disabled={busy}
            onClick={() =>
              void act(
                () => api(`/reports?kind=${kind}`, "POST"),
                "报告快照已保存",
              )
            }
          >
            <Plus size={15} />
            生成报告
          </button>
        </div>
      </div>
      {data.reports.length ? (
        <div className="report-list">
          {data.reports.map((r) => (
            <div key={r.id}>
              <BookOpen size={17} />
              <strong>
                #{r.id}{" "}
                {
                  (
                    {
                      daily: "持仓日报",
                      weekly: "持仓周报",
                      review: "模拟复盘",
                    } as Record<string, string>
                  )[r.kind]
                }
              </strong>
              <span>{date(r.created_at)}（上海）</span>
              <button className="text-button" onClick={() => download(r)}>
                下载 JSON <Download size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="尚未生成报告。生成后会保存计算结果和风险提示。" />
      )}
    </section>
  );
}

function Settings({
  data,
  act,
  busy,
  edit,
}: {
  data: Data;
  act: Action;
  busy: boolean;
  edit: (t?: Trade) => void;
}) {
  const sample =
    "account_id,symbol,side,quantity,price,fee,traded_at\n1,AAPL,buy,10,220,1,2026-10-15T10:00:00-04:00\n";
  const [csv, setCSV] = useState(sample),
    [result, setResult] = useState<ImportResult | null>(null),
    [rule, setRule] = useState("CN_MAIN"),
    [ruleText, setRuleText] = useState(
      JSON.stringify(data.rules.rules.CN_MAIN, null, 2),
    );
  function changeCSV(value: string) {
    setCSV(value);
    setResult(null);
  }
  return (
    <>
      {!isOffline && data.feed && (
        <MarketConnection
          key={JSON.stringify([
            data.feed.mode,
            data.feed.twelve_personal_use,
            data.feed.akshare_personal_use,
          ])}
          feed={data.feed}
          act={act}
          busy={busy}
        />
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>导入持仓交易</h3>
            <p>
              UTF-8 CSV · 最大 1 MB / 1,000 行 · 时区必填 · 不会调用真实账户
            </p>
          </div>
          <CSVLink path="/trades/template.csv">下载模板</CSVLink>
        </div>
        <div className="pad">
          <p className="muted">
            账户 1 = USD 持仓，账户 2 = CNY 持仓。方向 buy /
            sell，不能导入虚拟账户。股息、拆股和资金转入请勿作为股票成交导入。
          </p>
          <label className="upload">
            <Upload size={19} />
            <span>选择 CSV 文件</span>
            <input
              aria-label="上传CSV文件"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void act(async () => {
                    if (file.size > 1000000) throw new Error("文件超过 1 MB");
                    changeCSV(await file.text());
                  });
              }}
            />
          </label>
          <textarea
            aria-label="CSV内容"
            className="code"
            rows={6}
            value={csv}
            onChange={(e) => changeCSV(e.target.value)}
          />
          <div className="inline-controls">
            <button
              className="outline-button"
              disabled={busy}
              onClick={() =>
                void act(
                  async () =>
                    setResult(
                      await api<ImportResult>("/trades/import", "POST", {
                        content: csv,
                        dry_run: true,
                      }),
                    ),
                  "校验完成，尚未写入",
                )
              }
            >
              <Search size={15} />
              校验并预览
            </button>
            <button
              className="button"
              disabled={
                busy ||
                !result?.dry_run ||
                result.errors.length > 0 ||
                result.accepted === 0
              }
              onClick={() =>
                void act(
                  async () =>
                    setResult(
                      await api<ImportResult>("/trades/import", "POST", {
                        content: csv,
                        dry_run: false,
                      }),
                    ),
                  "导入处理完成，请查看行级结果",
                )
              }
            >
              <Upload size={15} />
              确认导入
            </button>
          </div>
          {result && (
            <div
              className={`notice ${result.errors.length ? "amber" : "green"} import-result`}
            >
              <div>
                <strong>
                  {result.dry_run ? "预览" : "处理结果"}：可接受{" "}
                  {result.accepted} 行 · 重复 {result.duplicates.length} 行 ·
                  错误 {result.errors.length} 行
                </strong>
                <p>
                  重复行号：{result.duplicates.join("、") || "无"}
                  。发生错误则整批不写入；重复行跳过。
                </p>
                {result.errors.map((e, i) => (
                  <p key={i}>
                    第 {e.line} 行：{e.error}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>历史成交与修改</h3>
            <p>最近 100 笔 · 演示初始资金固定 · 模拟成交不可编辑或删除</p>
          </div>
          <button className="button" onClick={() => edit()}>
            <Plus size={16} />
            新增交易
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>标的 / 账户</th>
                <th>成交时间（上海）</th>
                <th>方向 / 股数</th>
                <th>价格 / 费用（账户原币）</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.symbol}</strong>
                    <small>
                      {data.accounts.find((a) => a.id === t.account_id)?.name}
                    </small>
                  </td>
                  <td>{date(t.traded_at)}</td>
                  <td>
                    {t.side === "buy" ? "买入" : "卖出"} {t.quantity}
                  </td>
                  <td>
                    {amount(
                      t.price,
                      data.accounts.find((a) => a.id === t.account_id)
                        ?.currency,
                    )}
                    <small>费用 {t.fee}</small>
                  </td>
                  <td>
                    {t.paper_order_id ? (
                      <Badge>模拟成交</Badge>
                    ) : (
                      <div className="row-actions">
                        <button className="text-button" onClick={() => edit(t)}>
                          编辑
                        </button>
                        <button
                          className="text-button danger"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `确认删除交易 #${t.id}？系统将重新核算该账户全部后续持仓。`,
                              )
                            )
                              void act(
                                () =>
                                  api(`/trades/${t.id}?confirm=true`, "DELETE"),
                                "交易已删除",
                              );
                          }}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>模拟交易规则表</h3>
            <p>按标的映射板块规则，可调整参数；错误配置会影响模拟结果</p>
          </div>
          <select
            aria-label="规则类型"
            value={rule}
            onChange={(e) => {
              setRule(e.target.value);
              setRuleText(
                JSON.stringify(data.rules.rules[e.target.value], null, 2),
              );
            }}
          >
            {Object.entries(data.rules.rules).map(([key, value]) => (
              <option key={key} value={key}>
                {String(value.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="pad">
          <textarea
            aria-label="交易规则JSON"
            className="code"
            rows={12}
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
          />
          <button
            className="outline-button"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  api(`/execution-rules/${rule}`, "PUT", JSON.parse(ruleText)),
                "模拟参数已保存",
              )
            }
          >
            保存模拟规则
          </button>
          <p className="muted">{data.rules.source}</p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>数据与安全边界</h3>
            <p>行情接口：MarketDataProvider → DemoMarketDataProvider</p>
          </div>
          <Badge kind="green">无密钥运行</Badge>
        </div>
        <div className="pad">
          <p>
            {data.feed?.mode === "real"
              ? "当前按真实行情缓存估值，报价缺失时留空；不使用演示数据替代。供应商访问仅在后端，密钥不传给浏览器。"
              : "当前使用明确标识的虚构行情；浏览器演示仅提供样例，真实行情尚未接入此部署。"}
            AI分析仍是规则引擎。
          </p>
          <p>
            {isOffline
              ? "当前为浏览器演示：数据只保存在此浏览器，不会上传到服务器，也不与FastAPI/SQLite完整版同步。CSV只接受模板的无引号7列格式；请勿多标签同时编辑。更换浏览器或清理数据前，请先导出CSV及报告。"
              : "单用户本机工具；默认绑定127.0.0.1，API限制本机Host和跨站写入。公开部署前必须增加身份验证、访问控制、TLS、备份与数据许可审核。"}
          </p>
          <p>
            暂不支持逐笔实时行情、LLM解释、实盘、公司行为、现金流、完整节假日日历、基准与时间加权绩效。免费来源不代表有公开展示或商业使用权限。不要输入券商凭据。
          </p>
          <CSVLink path="/reports/export.csv">导出持仓 CSV</CSVLink>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>操作审计</h3>
            <p>最近 50 条本地记录 · 不记录凭据或导入原文</p>
          </div>
        </div>
        <div className="audit-list">
          {data.audit.length ? (
            data.audit.map((a) => (
              <div key={a.id}>
                <span>{date(a.created_at)}</span>
                <strong>{a.action}</strong>
                <small>{a.detail}</small>
              </div>
            ))
          ) : (
            <Empty text="尚无用户修改记录。" />
          )}
        </div>
      </section>
    </>
  );
}

function TradeModal({
  data,
  trade,
  close,
  act,
  busy,
}: {
  data: Data;
  trade: Trade | null;
  close: () => void;
  act: Action;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    account_id: String(trade?.account_id || 1),
    symbol: trade?.symbol || "AAPL",
    side: trade?.side || "buy",
    quantity: trade?.quantity || "10",
    price: trade?.price || "220",
    fee: trade?.fee || "1",
    traded_at: trade?.traded_at || "2026-10-15T10:00:00-04:00",
  });
  const currency = data.accounts.find(
    (a) => a.id === Number(form.account_id),
  )?.currency;
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-title"
      >
        <div className="panel-heading">
          <div>
            <h3 id="trade-title">{trade ? "编辑历史成交" : "录入历史成交"}</h3>
            <p>仅记账，不会执行任何交易 · 当前账户币种 {currency}</p>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <form
          className="pad"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api(
                trade ? `/trades/${trade.id}` : "/trades",
                trade ? "PUT" : "POST",
                { ...form, account_id: Number(form.account_id) },
              );
              close();
            }, "交易已保存并重新核算");
          }}
        >
          <div className="form-grid">
            <label>
              账户
              <select
                disabled={!!trade}
                value={form.account_id}
                onChange={(e) =>
                  setForm({
                    ...form,
                    account_id: e.target.value,
                    symbol: e.target.value === "1" ? "AAPL" : "600036",
                  })
                }
              >
                {data.accounts
                  .filter((a) => !a.paper)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              股票
              <select
                value={form.symbol}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              >
                {data.market
                  .filter((s) => s.currency === currency)
                  .map((s) => (
                    <option key={s.symbol} value={s.symbol}>
                      {s.name} · {s.symbol}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              方向
              <select
                value={form.side}
                onChange={(e) => setForm({ ...form, side: e.target.value })}
              >
                <option value="buy">买入</option>
                <option value="sell">卖出</option>
              </select>
            </label>
            {(["quantity", "price", "fee"] as const).map((k) => (
              <label key={k}>
                {
                  {
                    quantity: "股数",
                    price: `成交价 (${currency})`,
                    fee: `手续费 (${currency})`,
                  }[k]
                }
                <input
                  required
                  type="number"
                  min={k === "fee" ? 0 : 0.000001}
                  step="0.000001"
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="block-label">
            成交时间（ISO 8601，包含时区）
            <input
              required
              value={form.traded_at}
              onChange={(e) => setForm({ ...form, traded_at: e.target.value })}
              placeholder="2026-10-15T10:00:00-04:00"
            />
          </label>
          <p className="muted">
            历史持仓录入是记录已发生成交，不校验交易所整手或开市规则；仍校验币种、现金与卖出持仓。模拟下单会另行执行交易规则检查。
          </p>
          <button className="button" disabled={busy}>
            保存交易
          </button>
        </form>
      </section>
    </div>
  );
}

function App() {
  const [page, setPage] = useState(0),
    [account, setAccount] = useState(""),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [selected, setSelected] = useState("AAPL"),
    [chartSymbol, setChartSymbol] = useState("AAPL"),
    [stock, setStock] = useState<Stock | null>(null),
    [modal, setModal] = useState<{ trade: Trade | null } | null>(null),
    [showGuide, setShowGuide] = useState(false),
    [beginnerMode, setBeginnerMode] = useState(() => {
      try {
        return localStorage.getItem("stockpilot-beginner-mode") !== "advanced";
      } catch {
        return true;
      }
    }),
    [theme, setTheme] = useState(() => {
      try {
        return (
          localStorage.getItem("stockpilot-theme") ||
          (window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light")
        );
      } catch {
        return "light";
      }
    });
  const [expandedGroup, setExpandedGroup] = useState<number | null>(0);
  useEffect(() => {
    try {
      localStorage.setItem("stockpilot-beginner-mode", beginnerMode ? "beginner" : "advanced");
    } catch {
      /* Beginner mode remains usable when browser storage is disabled. */
    }
  }, [beginnerMode]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("stockpilot-theme", theme);
    } catch {
      /* Theme may be session-only in private browsers. */
    }
  }, [theme]);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    try {
      const result = await loadData(account);
      if (id === generation.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (id === generation.current)
        setError(e instanceof Error ? e.message : "连接失败");
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [account]);
  const initialRefresh = useRef(false);
  useEffect(() => {
    if (isOffline || data?.feed?.mode !== "real" || initialRefresh.current)
      return;
    initialRefresh.current = true;
    setBusy(true);
    api("/market-data/refresh", "POST")
      .catch((e) => setToast({ text: String(e), error: true }))
      .finally(() => {
        void reload();
        setBusy(false);
      });
  }, [data?.feed?.mode, reload]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const selectedQuoteUpdated = data?.feed?.quotes[chartSymbol]?.fetched_at;
  useEffect(() => {
    let mounted = true;
    setStock(null);
    api<Stock>(`/market-data/${chartSymbol}`)
      .then((s) => {
        if (mounted) setStock(s);
      })
      .catch((e) => {
        if (mounted) setToast({ text: String(e), error: true });
      });
    return () => {
      mounted = false;
    };
  }, [chartSymbol, data?.feed?.mode, selectedQuoteUpdated]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  const act: Action = async (work, success) => {
    setBusy(true);
    try {
      await work();
      if (success) setToast({ text: success, error: false });
    } catch (e) {
      setToast({
        text: e instanceof Error ? e.message : String(e),
        error: true,
      });
    } finally {
      await reload();
      setBusy(false);
    }
  };
  function navigate(p: number) {
    setPage(p);
    const targetGroup = navGroups.findIndex((group) => group.pageIds.includes(p));
    if (targetGroup !== -1) setExpandedGroup(targetGroup);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function diagnose(s: string) {
    setSelected(s);
    navigate(2);
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate(0);
          }}
        >
          <span>
            <Activity size={25} />
          </span>
          <div>
            StockPilot<small>AI 智能投资管理</small>
          </div>
        </a>
        <div className="workspace-label">个人投资工作台</div>
        <nav className="sidebar-navigation" aria-label="功能导航">
          <div className="nav-groups">
            {navGroups.map((group, groupIndex) => (
              <div className="nav-group" key={group.title}>
                <button
                  type="button"
                  className={`nav-group-trigger${expandedGroup === groupIndex ? " is-open" : ""}${group.pageIds.includes(page) ? " contains-active" : ""}`}
                  aria-expanded={expandedGroup === groupIndex}
                  aria-controls={`nav-group-${groupIndex}`}
                  onClick={() =>
                    setExpandedGroup((current) =>
                      current === groupIndex ? null : groupIndex,
                    )
                  }
                >
                  <group.icon size={18} aria-hidden="true" />
                  <span>{group.title}</span>
                  <ChevronRight className="nav-group-chevron" size={15} aria-hidden="true" />
                </button>
                {expandedGroup === groupIndex && (
                  <div className="nav-group-children" id={`nav-group-${groupIndex}`}>
                    {group.pageIds.map((index) => (
                      <button
                        key={pages[index].title}
                        type="button"
                        className={`nav-leaf${index === page ? " active" : ""}`}
                        aria-current={index === page ? "page" : undefined}
                        onClick={() => navigate(index)}
                      >
                        <span className="nav-leaf-dot" aria-hidden="true" />
                        <span>{pages[index].title}</span>
                        {index === 2 && <Badge>AI</Badge>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="safe-card">
            <ShieldCheck size={23} />
            <strong>先理解风险，再做决定</strong>
            <p>你的投资纪律，比市场情绪更重要。</p>
            <Badge>仅分析与模拟</Badge>
          </div>
          <div className="user">
            <span>SP</span>
            <div>
              个人演示空间<small>LOCAL WORKSPACE</small>
            </div>
            <button
              className="icon-button"
              title="打开数据与安全设置"
              onClick={() => navigate(6)}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            投资工作台 <ChevronRight size={13} />
            <strong>{pages[page].title}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button"
              aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="text-button beginner-mode-trigger"
              type="button"
              aria-pressed={beginnerMode}
              onClick={() => setBeginnerMode((active) => !active)}
              title="新手模式与专业模式可随时切换"
            >
              <BookOpen size={16} aria-hidden="true" />
              {beginnerMode ? "新手模式 · 开" : "开启新手模式"}
            </button>
            <button
              className="text-button guide-trigger"
              onClick={() => setShowGuide(true)}
            >
              <CircleHelp size={17} />
              使用指南
            </button>

            <span className="connection">
              <i />
              {isOffline
                ? "浏览器演示模式"
                : error
                  ? "服务连接异常"
                  : loading
                    ? "正在连接服务…"
                    : "前后端已连接"}
            </span>
            <button
              title="查看风险通知"
              className="icon-button notification"
              onClick={() => navigate(5)}
            >
              <Bell size={19} />
              <i />
            </button>
            <span className="avatar">SP</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">{pages[page].sub}</span>
              <h1>{pages[page].title}</h1>
            </div>
            <div className="heading-actions">
              <select
                aria-label="账户视图"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">全部持仓账户 · 合并视图</option>
                {data?.accounts
                  .filter((a) => !a.paper)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
              <button
                className="icon-button"
                title="刷新数据"
                disabled={busy || loading}
                onClick={() => void reload()}
              >
                <RefreshCw size={17} className={loading ? "spin" : ""} />
              </button>
              <CSVLink path="/reports/export.csv">
                <span>导出持仓</span>
              </CSVLink>
            </div>
          </div>
          <div className="demo-banner">
            <FlaskConical size={16} />
            <strong>
              {data?.feed?.mode === "real" ? "真实行情" : "演示环境"}
            </strong>
            <span>
              {data?.feed?.mode === "real"
                ? "真实日线模式：仅显示供应商报价与真实汇率缓存，缺失时不编造数值。账户可能仍含演示持仓；仅分析及模拟，不连接券商。"
                : "全部行情、汇率和初始资产均为虚构样例，非实时投资数据。AI 为规则分析，仅支持模拟交易。"}
            </span>
            <Badge kind="amber">实盘禁用</Badge>
          </div>
          {data?.feed?.mode === "real" && (
            <div className="live-feed-strip">
              <span>
                <i />
                {
                  Object.values(data.feed.quotes).filter((q) => q.cached).length
                }{" "}
                / 6 个标的有真实缓存 · 汇率
                {data.feed.fx.cached ? "已取得" : "未取得"}
              </span>
              <button className="text-button" onClick={() => navigate(6)}>
                行情连接与许可
              </button>
              <button
                className="outline-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api("/market-data/refresh", "POST"),
                    "刷新检查结束，请查看来源状态",
                  )
                }
              >
                <RefreshCw size={14} />
                更新真实行情
              </button>
            </div>
          )}
          {isOffline && (
            <div className="offline-banner">
              <Check size={16} />
              <span>
                <strong>可离线操作：</strong>无需服务器或密钥，交易与导入数据
                {offlinePersistent
                  ? "仅保存在此浏览器本机"
                  : "仅保存在当前页面，关闭前请导出"}
                ，不会发送到网络。此HTML文件本身只包含虚构样例。
              </span>
            </div>
          )}
          {error && (
            <div role="alert" className="notice red">
              <X size={18} />
              <div>
                <strong>数据加载失败</strong>
                <p>{error}</p>
                <button className="text-button" onClick={() => void reload()}>
                  重新连接
                </button>
              </div>
            </div>
          )}
          {data && beginnerMode && (
            <BeginnerGuide page={page} navigate={navigate} demo={data.feed?.mode !== "real"} />
          )}
          {!data ? (
            <div className="loading">
              {loading ? (
                <>
                  <LoaderCircle className="spin" /> 正在加载投资工作台…
                </>
              ) : (
                "请确认后端运行后重试。"
              )}
            </div>
          ) : (
            <div aria-busy={loading || busy}>
              {page === 0 && (
                <Dashboard
                  data={data}
                  stock={stock}
                  choose={setChartSymbol}
                  navigate={navigate}
                  diagnose={diagnose}
                />
              )}{" "}
              {page === 1 && (
                <Holdings
                  data={data}
                  diagnose={diagnose}
                  add={() => setModal({ trade: null })}
                />
              )}{" "}
              {page === 2 && (
                <Diagnosis
                  data={data}
                  selected={selected}
                  setSelected={setSelected}
                  act={act}
                  busy={busy}
                />
              )}{" "}
              {page === 3 && (
                <Research
                  data={data}
                  stock={stock}
                  choose={setChartSymbol}
                  act={act}
                />
              )}{" "}
              {page === 4 && <PaperTrading data={data} act={act} busy={busy} />}{" "}
              {page === 5 && (
                <RiskCenter
                  key={JSON.stringify(data.policy)}
                  data={data}
                  act={act}
                  busy={busy}
                />
              )}{" "}
              {page === 6 && (
                <Settings
                  data={data}
                  act={act}
                  busy={busy}
                  edit={(t) => setModal({ trade: t || null })}
                />
              )}
            </div>
          )}
          <footer>
            <span>
              <ShieldCheck size={13} /> AI StockPilot · 投资决策辅助工具
            </span>
            <span>不保证收益 · 不提供确定性买卖结论 · 本地数据由你掌控</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <CircleHelp size={19} /> : <Check size={19} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle className="spin" size={16} /> 正在保存并重新核算
        </div>
      )}
      {showGuide && (
        <div className="modal-backdrop">
          <section
            className="modal guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
          >
            <div className="panel-heading">
              <h3 id="guide-title">欢迎使用 AI StockPilot</h3>
              <button
                className="icon-button"
                aria-label="关闭使用指南"
                onClick={() => setShowGuide(false)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="pad">
              <p>
                <strong>1. 先看首页：</strong>
                已自动准备美股、A股、盈利与亏损持仓。今日行情缺失会如实显示，样例单日盈亏单独标注。
              </p>
              <p>
                <strong>2. 查看诊断：</strong>
                点击持仓右侧箭头，查看评分、推导及持有 / 减仓 / 退出情景。
              </p>
              <p>
                <strong>3. 体验模拟：</strong>
                进入模拟交易，选择美元账户、AAPL、10股，创建订单；明确勾选历史演示时钟后点击模拟成交，再创建卖出单体验平仓。
              </p>
              <p>
                <strong>4. 导入持仓：</strong>
                在导入与设置下载CSV模板，填写成交记录，选择文件，先校验预览再确认导入。目前支持内置6只股票；股息、拆股及转账请勿作为成交导入。
              </p>
              <p>
                <strong>数据边界：</strong>
                {isOffline
                  ? "当前是浏览器演示，所有操作都在此浏览器完成，数据不会上传到托管服务器。FastAPI后端未参与此演示的操作。"
                  : "当前是FastAPI+React完整版，数据写入此服务器的SQLite；不会连接券商。"}
                {data?.feed?.mode === "real"
                  ? "当前仅使用标明来源的真实缓存；缺失数据不编造。初始账户仍是演示账本。"
                  : "行情和汇率均为虚构样例。"}
                AI是规则分析，不是实时投资建议。
              </p>
              <button className="button" onClick={() => setShowGuide(false)}>
                开始体验
              </button>
            </div>
          </section>
        </div>
      )}
      {modal && data && (
        <TradeModal
          data={data}
          trade={modal.trade}
          close={() => setModal(null)}
          act={act}
          busy={busy}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
