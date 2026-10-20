import { useState } from "react";
import { Check, RefreshCw, ShieldCheck } from "lucide-react";
import { api, type FeedStatus } from "./api";

type Action = (work: () => Promise<unknown>, success?: string) => Promise<void>;

export function MarketConnection({
  feed,
  act,
  busy,
}: {
  feed: FeedStatus;
  act: Action;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    mode: feed.mode,
    twelve_personal_use: feed.twelve_personal_use,
    akshare_personal_use: feed.akshare_personal_use,
    akshare_license_reference: feed.akshare_license_reference,
  });
  return (
    <section className="panel connection-panel">
      <div className="panel-heading">
        <div>
          <h3>行情连接</h3>
          <p>免费数据源 · 私人内部使用 · 不购买或开通任何订阅</p>
        </div>
        <span className="badge">
          {feed.mode === "real" ? "真实行情模式" : "明确标识的演示模式"}
        </span>
      </div>
      <div className="pad">
        <div className="provider-cards">
          {feed.sources.map((source) => (
            <article key={source.provider}>
              <strong>{source.name}</strong>
              <p>
                {source.blocked_reason ||
                  (source.provider === "fx"
                    ? "无需密钥，使用ECB日参考汇率；待网络请求验证"
                    : "本机个人使用确认已记录，仍受账户和供应商权限限制")}
              </p>
              <small>
                {source.provider === "twelve"
                  ? `服务器密钥：${feed.twelve_key_present ? "已配置（不展示）" : "未配置"}`
                  : source.provider === "akshare"
                    ? "软件MIT许可不代表行情授权；未发现稳定性承诺"
                    : "日参考汇率，不是可成交外汇报价"}
              </small>
            </article>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api("/market-data/settings", "PUT", form),
              "行情设置已保存；未开通任何付费服务",
            );
          }}
        >
          <label className="block-label">
            估值使用的数据
            <select
              aria-label="行情模式"
              value={form.mode}
              onChange={(e) =>
                setForm({ ...form, mode: e.target.value as "real" | "demo" })
              }
            >
              <option value="real">真实行情 · 无数据时显示缺失</option>
              <option value="demo">演示行情 · 全部价格均为虚构</option>
            </select>
          </label>
          <label className="check-label terms-check">
            <input
              type="checkbox"
              checked={form.twelve_personal_use}
              onChange={(e) =>
                setForm({ ...form, twelve_personal_use: e.target.checked })
              }
            />
            我已核对 Twelve Data
            账户条款，确认允许本人的内部非商业使用；此项不授予公开展示或再分发权。
          </label>
          <p className="source">
            参考：
            <a
              href="https://twelvedata.com/pricing"
              target="_blank"
              rel="noreferrer"
            >
              免费方案
            </a>{" "}
            ·{" "}
            <a
              href="https://twelvedata.com/terms"
              target="_blank"
              rel="noreferrer"
            >
              使用条款
            </a>
            。免费额度、市场覆盖和延迟以账户实际权限为准。密钥只通过服务器环境变量
            TWELVE_DATA_API_KEY 配置，不在网页或聊天填写。
          </p>
          <details>
            <summary>A股：AKShare 上游数据许可</summary>
            <p>
              AKShare 源码为
              MIT；东方财富行情的数据权利独立。当前无法核实上游授权，因此默认关闭。请先取得并核实本人的使用依据，再记录官方条款链接；这不是商业或公开展示许可。
            </p>
            <label className="block-label">
              东方财富官方授权/条款链接
              <input
                aria-label="A股数据授权依据"
                type="url"
                placeholder="https://www.eastmoney.com/…"
                value={form.akshare_license_reference}
                onChange={(e) =>
                  setForm({
                    ...form,
                    akshare_license_reference: e.target.value,
                  })
                }
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.akshare_personal_use}
                onChange={(e) =>
                  setForm({ ...form, akshare_personal_use: e.target.checked })
                }
              />
              我已核实上游条款允许本人的个人使用，并记录了依据。仅勾选不代表已获得授权。
            </label>
          </details>
          <div className="inline-controls">
            <button className="button" disabled={busy}>
              <Check size={15} />
              保存行情设置
            </button>
            <button
              type="button"
              className="outline-button"
              disabled={busy || feed.mode !== "real"}
              onClick={() =>
                void act(
                  () => api("/market-data/refresh", "POST"),
                  "刷新检查结束；请查看各数据源的实际结果",
                )
              }
            >
              <RefreshCw size={15} />
              更新真实行情
            </button>
          </div>
        </form>
        <div className="notice inset-free">
          <ShieldCheck size={18} />
          <p>
            本机限制：{feed.minute_budget} 次/分钟、{feed.daily_budget}{" "}
            次/UTC日；成功缓存 {feed.success_cache_hours}{" "}
            小时，失败退避5分钟，刷新冷却至少 {feed.refresh_minutes} 分钟。
            {feed.budget_note}。只读历史数据，不连接券商。
          </p>
        </div>
        <div className="quote-status-list">
          {[...Object.entries(feed.quotes), ["USD/CNY", feed.fx] as const].map(
            ([symbol, q]) => (
              <div key={symbol}>
                <strong>{symbol}</strong>
                <span>
                  {q.as_of_date ? `报价日期 ${q.as_of_date}` : "暂无真实报价"}
                  {q.stale ? " · 过期/未知" : ""}
                </span>
                <small>
                  {q.fetched_at
                    ? `抓取于 ${new Date(q.fetched_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（上海）"}`
                    : "尚未成功更新"}
                </small>
                <p>{q.error || q.delay || "等待首次连接"}</p>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
