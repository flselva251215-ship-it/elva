import { useEffect, useState } from "react";
import { api, type EquityHistory } from "./api";

export function EquityChart({ revision }: { revision: string | null }) {
  const [account, setAccount] = useState("1"),
    [history, setHistory] = useState<EquityHistory | null>(null),
    [point, setPoint] = useState<number | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setHistory(null);
    setError("");
    api<EquityHistory>(`/performance?account_id=${account}`)
      .then((data) => {
        if (alive) {
          setHistory(data);
          setPoint(null);
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [account, revision]);
  const points = history?.points || [],
    active = points.length
      ? Math.min(point ?? points.length - 1, points.length - 1)
      : 0;
  const values = points.map((p) => Number(p.equity)),
    low = values.length ? Math.min(...values) : 0,
    high = values.length ? Math.max(...values) : 1;
  const span = Math.max(high - low, Math.abs(high) * 0.005, 1),
    h = 220,
    w = 780;
  const coords = values.map((value, i) => [
    (i * w) / Math.max(values.length - 1, 1),
    h - ((value - low + span * 0.05) / (span * 1.1)) * h,
  ]);
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <section className="panel equity-panel">
      <div className="panel-heading">
        <div>
          <h3>资产走势</h3>
          <p>单账户原币日终权益回溯，避免异币种直接相加</p>
        </div>
        <select
          aria-label="资产曲线账户"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="1">美元账户 · USD</option>
          <option value="2">人民币账户 · CNY</option>
        </select>
      </div>
      <div className="pad">
        {error ? (
          <div role="alert">{error}</div>
        ) : !history ? (
          <div className="empty">正在读取历史估值…</div>
        ) : points.length ? (
          <>
            <div className="equity-value">
              <strong>
                {Number(points[active].equity).toLocaleString("zh-CN", {
                  style: "currency",
                  currency: history.currency,
                })}
              </strong>
              <span>
                {points[active].date} · {history.demo ? "虚构价格" : "真实日线"}{" "}
                · 账本可能含演示持仓
              </span>
            </div>
            <svg
              role="img"
              aria-label="账户资产历史走势图"
              viewBox={`0 -8 ${w} ${h + 16}`}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setPoint(
                  Math.max(
                    0,
                    Math.min(
                      points.length - 1,
                      Math.round(
                        ((e.clientX - rect.left) / rect.width) *
                          (points.length - 1),
                      ),
                    ),
                  ),
                );
              }}
            >
              <defs>
                <linearGradient id="equity-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop stopColor="#007aff" stopOpacity=".18" />
                  <stop offset="1" stopColor="#007aff" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, h / 2, h].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2={w}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  opacity=".08"
                />
              ))}
              <polygon
                points={`0,${h} ${line} ${w},${h}`}
                fill="url(#equity-fill)"
              />
              <polyline
                points={line}
                fill="none"
                stroke="#007aff"
                strokeWidth="2.5"
              />
              <circle
                cx={coords[active][0]}
                cy={coords[active][1]}
                r="4"
                fill="#007aff"
              />
            </svg>
            <input
              className="chart-slider"
              aria-label="选择资产估值日期"
              type="range"
              min="0"
              max={points.length - 1}
              value={active}
              onChange={(e) => setPoint(Number(e.target.value))}
            />
            <div className="chart-dates">
              <span>{points[0].date}</span>
              <span>{points.at(-1)?.date}</span>
            </div>
          </>
        ) : (
          <div className="empty">
            {history.note}。请先在“导入与设置 → 行情连接”配置并更新数据。
          </div>
        )}
        <p className="source">
          {history?.note || "只使用当前模式的数据，不用演示价格填补真实曲线。"}
        </p>
      </div>
    </section>
  );
}
