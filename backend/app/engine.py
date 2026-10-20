"""Auditable calculations. Monetary arithmetic exclusively uses Decimal."""

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import math
import statistics
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .market import DemoMarketDataProvider, RULE_SOURCE, SOURCE, is_stale, selected_provider
from .feeds import cache_metadata, market_mode, real_fx
from .models import Account, AuditLog, ExecutionRule, FXRate, Instrument, RiskPolicy, Trade

D = Decimal
ZERO = D(0)


class DomainError(ValueError):
    pass


def audit(db, action, detail):
    db.add(AuditLog(action=action, detail=detail))


def fingerprint(data):
    values = [
        str(data.account_id),
        data.symbol,
        data.side,
        str(data.quantity.normalize()),
        str(data.price.normalize()),
        str(data.fee.normalize()),
        data.traded_at.astimezone(timezone.utc).isoformat(),
    ]
    return hashlib.sha256("|".join(values).encode()).hexdigest()


def average_cost(trades, initial_cash):
    """Weighted-average book cost includes buy fees; sell fees reduce realized P&L."""
    cash = D(initial_cash)
    lots = defaultdict(lambda: {"quantity": ZERO, "cost": ZERO, "realized": ZERO})
    for trade in sorted(trades, key=lambda t: (datetime.fromisoformat(t.traded_at), t.id or 2**63)):
        p = lots[trade.symbol]
        value = trade.price * trade.quantity
        if trade.side == "buy":
            cash -= value + trade.fee
            p["quantity"] += trade.quantity
            p["cost"] += value + trade.fee
        else:
            if trade.quantity > p["quantity"]:
                raise DomainError(f"{trade.symbol} 在该成交时间的可用持仓不足")
            removed = p["cost"] * trade.quantity / p["quantity"]
            p["cost"] -= removed
            p["quantity"] -= trade.quantity
            p["realized"] += value - trade.fee - removed
            cash += value - trade.fee
        if cash < 0:
            raise DomainError("历史交易导致账户现金不足；请检查成交时间、价格和数量")
    return cash, dict(lots)


def ledger(db, account_id):
    account = db.get(Account, account_id)
    if not account:
        raise DomainError("账户不存在")
    trades = list(db.scalars(select(Trade).where(Trade.account_id == account_id)))
    cash, lots = average_cost(trades, account.initial_cash)
    return account, cash, lots, trades


def indicators(bars):
    prices = [float(b.close) for b in bars]
    if not prices:
        return {"ma20": None, "rsi14": None, "volatility": None, "drawdown": None, "score": None}
    returns = [math.log(b / a) for a, b in zip(prices, prices[1:])]
    changes = [b - a for a, b in zip(prices, prices[1:])][-14:]
    gain = sum(max(x, 0) for x in changes)
    loss = sum(max(-x, 0) for x in changes)
    rsi = 100 - 100 / (1 + gain / loss) if loss else (100 if gain else 50)
    peak, dd = prices[0], 0.0
    for price in prices:
        peak = max(peak, price)
        dd = min(dd, price / peak - 1)
    ma = statistics.mean(prices[-20:]) if len(prices) >= 20 else None
    vol = statistics.stdev(returns) * math.sqrt(252) if len(returns) >= 2 else None
    # Transparent research heuristic, not expected return.
    score = (
        (40 if ma and prices[-1] >= ma else 10)
        + (30 if 30 <= rsi <= 70 else 10)
        + (30 if vol is not None and vol < 0.35 else 10)
    )
    return {
        "ma20": ma,
        "rsi14": rsi if len(changes) == 14 else None,
        "volatility": vol,
        "drawdown": dd,
        "score": score,
    }


def market_detail(db, symbol, demo_override=False):
    instrument = db.get(Instrument, symbol)
    if not instrument:
        raise DomainError("股票不存在；MVP 仅支持内置演示股票")
    demo = demo_override or market_mode(db) == "demo"
    bars = selected_provider(db, demo_override).bars(symbol)
    metadata = (
        {} if demo else cache_metadata(db, symbol, "twelve" if instrument.market == "US" else "akshare")
    )
    return {
        "symbol": symbol,
        "name": instrument.name,
        "market": instrument.market,
        "currency": instrument.currency,
        "sector": instrument.sector,
        "rule_key": instrument.rule_key,
        "price": bars[-1].close if bars else None,
        "timestamp": bars[-1].timestamp if bars else None,
        "source": SOURCE if demo else metadata.get("source", "真实行情尚未取得"),
        "stale": (is_stale(bars[-1].timestamp) if bars else True) if demo else metadata["stale"],
        "demo": demo,
        "provenance": metadata,
        "bars": [{"timestamp": b.timestamp, "close": b.close, "volume": b.volume} for b in bars],
        "metrics": indicators(bars),
        "valuation": None,
        "earnings_date": None,
        "limitations": ("虚构历史，" if demo else "供应商日线缓存，只有交易日期、无逐笔报价时刻，")
        + "未复权；估值、财报、停牌及公司行为数据缺失。评分不代表收益概率。",
        "score_formula": "趋势：价格≥MA20 得40分，否则10；RSI14在30–70得30分，否则10；年化波动<35%得30分，否则10。",
    }


def portfolio(db, account_id=None, paper=False):
    query = select(Account).where(Account.paper == paper)
    if account_id is not None:
        query = query.where(Account.id == account_id)
    accounts = list(db.scalars(query))
    if account_id is not None and not accounts:
        raise DomainError("该视图下账户不存在")
    results, positions = [], []
    for account in accounts:
        _, cash, lots, account_trades = ledger(db, account.id)
        market_value, unrealized, realized, missing = ZERO, ZERO, ZERO, []
        for symbol, lot in lots.items():
            realized += lot["realized"]
            if not lot["quantity"]:
                continue
            data = market_detail(db, symbol, demo_override=paper)
            price = data["price"]
            mv = price * lot["quantity"] if price is not None else None
            pnl = mv - lot["cost"] if mv is not None else None
            if mv is None:
                missing.append(symbol)
            else:
                market_value += mv
                unrealized += pnl
            positions.append(
                {
                    "account_id": account.id,
                    **{
                        k: data[k]
                        for k in [
                            "symbol",
                            "name",
                            "market",
                            "currency",
                            "sector",
                            "price",
                            "timestamp",
                            "source",
                            "stale",
                            "demo",
                            "provenance",
                        ]
                    },
                    **lot,
                    "average_cost": lot["cost"] / lot["quantity"],
                    "market_value": mv,
                    "unrealized": pnl,
                    "return_pct": pnl / lot["cost"] if pnl is not None and lot["cost"] else None,
                    "metrics": data["metrics"],
                }
            )
        session_pnl, session_date, today_pnl = session_change(
            db, account, account_trades, cash + market_value, demo_override=paper
        )
        results.append(
            {
                "id": account.id,
                "name": account.name,
                "currency": account.currency,
                "paper": account.paper,
                "initial_cash": account.initial_cash,
                "cash": cash,
                "market_value": market_value if not missing else None,
                "equity": cash + market_value if not missing else None,
                "realized": realized,
                "total_pnl": realized + unrealized if not missing else None,
                "latest_session_pnl": session_pnl if not missing else None,
                "latest_session_date": session_date,
                "today_pnl": today_pnl if not missing else None,
                "unrealized": unrealized if not missing else None,
                "return_pct": (realized + unrealized) / account.initial_cash if not missing else None,
                "missing_prices": missing,
            }
        )
    demo = paper or market_mode(db) == "demo"
    fx = db.get(FXRate, "USDCNY") if demo else real_fx(db)

    def convert(value, currency):
        if value is None:
            return None
        return value if currency == "CNY" else (value * fx.rate if fx else None)

    combined = {}
    for field in [
        "equity",
        "cash",
        "market_value",
        "realized",
        "unrealized",
        "initial_cash",
        "total_pnl",
        "latest_session_pnl",
        "today_pnl",
    ]:
        values = [convert(a[field], a["currency"]) for a in results]
        combined[field] = sum(values, ZERO) if all(v is not None for v in values) else None
    combined["currency"] = "CNY"
    combined["latest_session_date"] = max(
        (a["latest_session_date"] for a in results if a["latest_session_date"]), default=None
    )
    combined["return_pct"] = (
        (combined["realized"] + combined["unrealized"]) / combined["initial_cash"]
        if combined["unrealized"] is not None and combined["initial_cash"]
        else None
    )
    for p in positions:
        mv = convert(p["market_value"], p["currency"])
        p["weight"] = mv / combined["equity"] if mv is not None and combined["equity"] else None
        if len(results) == 1 and results[0]["equity"] and p["market_value"] is not None:
            p["weight"] = p["market_value"] / results[0]["equity"]
        p["contribution_cny"] = convert(p["unrealized"], p["currency"])
    return {
        "accounts": results,
        "positions": positions,
        "combined": combined,
        "demo": demo,
        "holdings_note": "账户与初始持仓为演示账本；行情来源与账本真实性分别标注",
        "fx": {
            "pair": fx.pair,
            "rate": fx.rate,
            "timestamp": fx.timestamp,
            "source": fx.source,
            "stale": is_stale(fx.timestamp) if demo else fx.metadata["stale"],
            "provenance": {} if demo else fx.metadata,
        }
        if fx
        else None,
        "as_of": max((p["timestamp"] for p in positions if p["timestamp"]), default=None),
        "warnings": [
            "演示行情模式：全部报价为虚构样例"
            if demo
            else "真实日线缓存模式：不代表实时行情；缺报价或汇率时不回退到虚构数据",
            "不同市场收盘时点不同；日参考汇率不等于可成交汇率",
            "收益率为累计盈亏 / 初始投入，不是年化或时间加权收益",
        ],
    }


def session_change(db, account, trades, current_equity, demo_override=False):
    """Daily change of equity, including trades/fees; never label stale quotes as today's P&L."""
    instruments = list(db.scalars(select(Instrument).where(Instrument.currency == account.currency)))
    series = {i.symbol: selected_provider(db, demo_override).bars(i.symbol) for i in instruments}
    complete = [bars for bars in series.values() if len(bars) >= 2]
    if len(complete) != len(instruments) or not complete:
        return None, None, None
    cutoff = max(bars[-1].timestamp for bars in complete)
    previous = max(bars[-2].timestamp for bars in complete)
    zone = ZoneInfo("America/New_York" if account.currency == "USD" else "Asia/Shanghai")
    local_date = datetime.fromisoformat(cutoff).astimezone(zone).date()
    if market_mode(db) == "real" and not demo_override:
        cutoff = datetime.combine(
            local_date, datetime.min.time().replace(hour=16 if account.currency == "USD" else 15), zone
        ).isoformat()
        prev_day = datetime.fromisoformat(previous).astimezone(zone).date()
        previous = datetime.combine(
            prev_day, datetime.min.time().replace(hour=16 if account.currency == "USD" else 15), zone
        ).isoformat()
    if any(datetime.fromisoformat(t.traded_at) > datetime.fromisoformat(cutoff) for t in trades):
        return None, local_date.isoformat(), None
    before = [t for t in trades if datetime.fromisoformat(t.traded_at) <= datetime.fromisoformat(previous)]
    cash, lots = average_cost(before, account.initial_cash)
    old_equity = cash + sum(
        (lot["quantity"] * series[symbol][-2].close for symbol, lot in lots.items()), ZERO
    )
    pnl = current_equity - old_equity
    today = datetime.now(timezone.utc).astimezone(zone).date()
    return (
        pnl,
        local_date.isoformat(),
        pnl if today == local_date and (demo_override or market_mode(db) == "demo") else None,
    )


def correlations(db, symbols):
    series = {}
    for symbol in set(symbols):
        bars = selected_provider(db).bars(symbol)
        series[symbol] = {b.timestamp[:10]: float(b.close / a.close - 1) for a, b in zip(bars, bars[1:])}
    values = []
    names = sorted(series)
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            dates = sorted(set(series[a]) & set(series[b]))
            if len(dates) < 20:
                continue
            x, y = [series[a][d] for d in dates], [series[b][d] for d in dates]
            if statistics.pstdev(x) and statistics.pstdev(y):
                corr = statistics.correlation(x, y)
                if corr > 0.8:
                    values.append({"symbols": [a, b], "correlation": round(corr, 4)})
    return values


def equity_history(db, account_id=1):
    account, _, _, trades = ledger(db, account_id)
    provider = selected_provider(db, demo_override=account.paper)
    symbols = sorted({t.symbol for t in trades})
    series = {s: {b.timestamp[:10]: b for b in provider.bars(s)} for s in symbols}
    if not symbols or any(not values for values in series.values()):
        return {
            "points": [],
            "currency": account.currency,
            "account_id": account_id,
            "note": "缺少对应标的真实日线，不能绘制资产曲线",
        }
    dates = sorted(set.intersection(*(set(v) for v in series.values())))
    zone = ZoneInfo("America/New_York" if account.currency == "USD" else "Asia/Shanghai")
    today = datetime.now(timezone.utc).astimezone(zone).date().isoformat()
    points = []
    for day in dates:
        if day >= today and market_mode(db) == "real" and not account.paper:
            continue
        cutoff = datetime.combine(
            date_from_iso(day),
            datetime.min.time().replace(hour=16 if account.currency == "USD" else 15),
            zone,
        )
        cash, lots = average_cost(
            [t for t in trades if datetime.fromisoformat(t.traded_at) <= cutoff], account.initial_cash
        )
        equity = cash + sum(
            (lot["quantity"] * series[symbol][day].close for symbol, lot in lots.items()), ZERO
        )
        points.append({"date": day, "equity": equity, "return_pct": equity / account.initial_cash - 1})
    return {
        "account_id": account_id,
        "currency": account.currency,
        "points": points,
        "demo": account.paper or market_mode(db) == "demo",
        "note": "按该账户原币、成交账本与已结束交易日的未复权收盘值回溯；含手续费。不含股息、入出金或汇兑收益。演示初始持仓不等于用户实际持仓。",
    }


def date_from_iso(value):
    from datetime import date

    return date.fromisoformat(value)


def risk_analysis(db, account_id=None):
    data = portfolio(db, account_id)
    policy = db.get(RiskPolicy, 1)
    alerts, diagnostics = [], []
    sectors = defaultdict(lambda: ZERO)
    for p in data["positions"]:
        reasons = []
        score = 0
        if p["weight"] is not None and p["weight"] > policy.single_limit:
            reasons.append("单股仓位超过上限")
            score += 35
        if p["return_pct"] is not None and p["return_pct"] < -policy.max_loss:
            reasons.append("持仓亏损超过承受阈值")
            score += 35
        if p["metrics"]["volatility"] is not None and p["metrics"]["volatility"] > 0.35:
            reasons.append("历史年化波动超过 35%")
            score += 15
        if p["metrics"]["drawdown"] is not None and p["metrics"]["drawdown"] < -float(policy.max_loss):
            reasons.append("历史最大回撤超过承受阈值")
            score += 20
        if p["stale"] or p["price"] is None:
            reasons.append("行情过期或缺失，需要复核")
            score += 20
        bars = selected_provider(db).bars(p["symbol"])
        if len(bars) > 1 and abs(bars[-1].close / bars[-2].close - 1) > D("0.05"):
            reasons.append("最新收盘变化超过 5%（无开盘数据，不能判断真实跳空）")
            score += 15
        if p["weight"] is not None:
            sectors[p["sector"]] += p["weight"]
        scenarios = []
        if p["unrealized"] is not None and p["unrealized"] < 0:
            instrument = db.get(Instrument, p["symbol"])
            rule = json.loads(db.get(ExecutionRule, instrument.rule_key).payload)
            for title, portion in [("继续持有", ZERO), ("逐步减仓", D("0.5")), ("退出", D(1))]:
                if portion == D("0.5"):
                    quantity = (p["quantity"] * portion // D(rule["lot"])) * D(rule["lot"])
                else:
                    quantity = p["quantity"] * portion
                gross = quantity * p["price"]
                slip = gross * D(rule["slippage"])
                net_gross = gross - slip
                fees = (
                    max(net_gross * D(rule["fee_rate"]), D(rule["min_fee"])) + net_gross * D(rule["sell_tax"])
                    if quantity
                    else ZERO
                )
                remaining = (p["quantity"] - quantity) * p["price"]
                scenarios.append(
                    {
                        "name": title,
                        "quantity": quantity,
                        "fees": fees,
                        "slippage_cost": slip,
                        "proceeds": net_gross - fees,
                        "down_10_loss": -remaining * D("0.10") - fees - slip,
                        "up_10_gain": remaining * D("0.10") - fees - slip,
                        "trigger": "仅在数据更新并复核风险预算后评估；遵守可卖数量与交易规则",
                        "assumption": "假设以样例价格成交，余仓随后±10%；结果是相对当前市值变化，不是预测",
                    }
                )
        state = "风险偏高" if score >= 50 else ("需要复核" if score else "继续观察")
        diagnostics.append(
            {
                **p,
                "risk_score": min(score, 100),
                "status": state,
                "reasons": reasons,
                "scenarios": scenarios,
                "engine": "可解释规则引擎（未调用大模型）",
                "formula": "风险分=超单股限额35+超亏损阈值35+波动>35%加15+回撤超限20+过期20+收盘变动>5%加15，上限100；仓位=折人民币市值/总资产。成本=含买入费的移动平均成本。",
                "risk_note": "补仓会扩大敞口，不能保证回本。需核实样例外的真实行情和个人约束；系统不生成确定性买卖命令。",
            }
        )
        for reason in reasons:
            alerts.append(
                {"symbol": p["symbol"], "level": "high" if score >= 50 else "review", "message": reason}
            )
    for sector, weight in sectors.items():
        if weight > policy.sector_limit:
            alerts.append(
                {"symbol": sector, "level": "high", "message": "行业敞口超过上限", "weight": weight}
            )
    equity, cash = data["combined"]["equity"], data["combined"]["cash"]
    if equity and cash is not None and cash / equity < policy.cash_floor:
        alerts.append({"symbol": "组合", "level": "high", "message": "现金比例低于底线"})
    if data["fx"] is None or data["fx"]["stale"]:
        alerts.append({"symbol": "汇率", "level": "review", "message": "汇率缺失或过期，合并结果仅供演示"})
    if len({a["currency"] for a in data["accounts"]}) > 1:
        alerts.append(
            {
                "symbol": "汇率",
                "level": "review",
                "message": "存在人民币/美元汇率风险；当前未估算真实汇兑收益",
            }
        )
    pairs = correlations(db, [p["symbol"] for p in data["positions"]])
    for pair in pairs:
        alerts.append(
            {
                "symbol": "/".join(pair["symbols"]),
                "level": "review",
                "message": "样例收益相关性超过 0.8",
                **pair,
            }
        )
    mv = data["combined"]["market_value"]
    usd = sum(
        (a["equity"] for a in data["accounts"] if a["currency"] == "USD" and a["equity"] is not None), ZERO
    )
    fx = data["fx"]
    stress = [
        {"name": f"全部股票价格下跌 {pct}%", "change_cny": -mv * D(pct) / 100 if mv is not None else None}
        for pct in (5, 10)
    ]
    stress += [
        {
            "name": "美元兑人民币下跌 5%（美元资产折算）",
            "change_cny": -usd * fx["rate"] * D("0.05") if fx else None,
        }
    ]
    return {
        "diagnostics": diagnostics,
        "alerts": alerts,
        "sectors": dict(sectors),
        "correlations": pairs,
        "stress": stress,
        "stress_note": "假设模拟而非预测；股票采用统一冲击，不代表指数 beta；现金不受股票跌幅影响。",
        "policy": {
            k: getattr(policy, k)
            for k in ["single_limit", "sector_limit", "max_loss", "cash_floor", "order_limit"]
        },
        "source": SOURCE if market_mode(db) == "demo" else "所列供应商真实日线缓存；账户可能含演示持仓",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of": data["as_of"],
    }


def execution_constraints(rule, quantity, side, held, buys_today):
    lot = D(rule["lot"])
    if quantity % lot and not (side == "sell" and quantity == held):
        raise DomainError(f"本标的交易单位为 {lot} 股（仅允许一次卖出全部零股）")
    if side == "sell" and quantity > held - (buys_today if rule["t_plus"] else ZERO):
        raise DomainError("可卖数量不足或触发 A 股 T+1 限制")


def fill_paper_order(db, order, demo_clock=False):
    if order.status != "pending":
        raise DomainError("仅待成交订单可执行；订单不可重复成交")
    account, cash, lots, trades = ledger(db, order.account_id)
    instrument = db.get(Instrument, order.symbol)
    rule = json.loads(db.get(ExecutionRule, instrument.rule_key).payload)
    bars = DemoMarketDataProvider(db).bars(order.symbol)
    try:
        if not account.paper:
            raise DomainError("只能在虚拟账户执行模拟订单")
        if not bars:
            raise DomainError("行情缺失，禁止成交")
        now = datetime.fromisoformat(bars[-1].timestamp) if demo_clock else datetime.now(timezone.utc)
        if not demo_clock and is_stale(bars[-1].timestamp, now):
            raise DomainError("行情过期；如需历史样例演练，必须明确勾选演示时钟")
        local = now.astimezone(ZoneInfo(rule["timezone"]))
        hhmm = local.strftime("%H:%M")
        if local.weekday() >= 5 or not any(a <= hhmm < b for a, b in rule["sessions"]):
            raise DomainError("当前不在配置的模拟交易时段内（不含节假日日历）")
        if any(datetime.fromisoformat(t.traded_at) > now for t in trades):
            raise DomainError("演示时钟早于已有成交，禁止倒序成交")
        buys_today = sum(
            (
                t.quantity
                for t in trades
                if t.symbol == order.symbol
                and t.side == "buy"
                and datetime.fromisoformat(t.traded_at).astimezone(ZoneInfo(rule["timezone"])).date()
                == local.date()
            ),
            ZERO,
        )
        held = lots.get(order.symbol, {}).get("quantity", ZERO)
        execution_constraints(rule, order.quantity, order.side, held, buys_today)
        if order.quantity > D(bars[-1].volume) * D(rule["volume_fraction"]):
            raise DomainError("超过样例日成交量参与率上限；未模拟订单簿")
        price = (bars[-1].close * (1 + D(rule["slippage"]) * (1 if order.side == "buy" else -1))).quantize(
            D("0.01")
        )
        if rule["limit_pct"] is not None and len(bars) >= 2:
            change = price / bars[-2].close - 1
            if abs(change) > D(rule["limit_pct"]):
                raise DomainError("模拟成交价超过配置的昨收涨跌幅限制")
        value = order.quantity * price
        fee = (
            max(value * D(rule["fee_rate"]), D(rule["min_fee"]))
            + (value * D(rule["sell_tax"]) if order.side == "sell" else ZERO)
        ).quantize(D("0.01"))
        policy = db.get(RiskPolicy, 1)
        if value > policy.order_limit:
            raise DomainError("计划交易金额超过风控上限（按账户币种）")
        if order.side == "buy" and value + fee > cash:
            raise DomainError("虚拟现金不足（含费用和滑点）")
        if order.side == "buy":
            paper = portfolio(db, order.account_id, paper=True)
            equity = paper["accounts"][0]["equity"]
            if equity and (cash - value - fee) / (equity - fee) < policy.cash_floor:
                raise DomainError("本次买入将低于现金底线")
        trade = Trade(
            account_id=account.id,
            symbol=order.symbol,
            side=order.side,
            quantity=order.quantity,
            price=price,
            fee=fee,
            traded_at=now.isoformat(),
            fingerprint=f"paper-{order.id}",
            paper_order_id=order.id,
        )
        average_cost([*trades, trade], account.initial_cash)
        db.add(trade)
        order.status, order.fill_price, order.fee = "filled", price, fee
        order.executed_at = now.isoformat()
        order.reason = "历史演示时钟成交（虚构行情）" if demo_clock else "模拟成交（非实盘）"
    except DomainError as exc:
        order.status, order.reason = "rejected", str(exc)
    audit(db, "paper_order_" + order.status, f"order={order.id}; {order.reason}")
    return order


def rules_response(db):
    return {
        "rules": {r.key: json.loads(r.payload) for r in db.scalars(select(ExecutionRule))},
        "source": RULE_SOURCE,
    }
