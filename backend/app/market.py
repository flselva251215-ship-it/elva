"""Replaceable provider boundary. No network feeds and no broker interfaces."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from typing import Protocol

from sqlalchemy import select

from .models import Account, ExecutionRule, FXRate, Instrument, PriceBar, RiskPolicy, Trade, Watchlist

D = Decimal
SOURCE = "内置虚构演示数据 v1 · 非实时行情 · 未复权"
AS_OF = "2026-10-16T20:00:00+00:00"

# Per instrument rule mapping: no assertion that all A shares have a 10% band.
RULES = {
    "CN_MAIN": {
        "name": "沪深主板普通股（演示）",
        "lot": 100,
        "t_plus": 1,
        "limit_pct": "0.10",
        "fee_rate": "0.0003",
        "min_fee": "5",
        "sell_tax": "0.0005",
        "slippage": "0.0005",
        "volume_fraction": "0.01",
        "timezone": "Asia/Shanghai",
        "sessions": [["09:30", "11:30"], ["13:00", "15:00"]],
    },
    "CN_GEM": {
        "name": "创业板普通股（演示）",
        "lot": 100,
        "t_plus": 1,
        "limit_pct": "0.20",
        "fee_rate": "0.0003",
        "min_fee": "5",
        "sell_tax": "0.0005",
        "slippage": "0.0005",
        "volume_fraction": "0.01",
        "timezone": "Asia/Shanghai",
        "sessions": [["09:30", "11:30"], ["13:00", "15:00"]],
    },
    "US_REGULAR": {
        "name": "美股普通股票（演示、整数股）",
        "lot": 1,
        "t_plus": 0,
        "limit_pct": None,
        "fee_rate": "0.0001",
        "min_fee": "1",
        "sell_tax": "0",
        "slippage": "0.0005",
        "volume_fraction": "0.01",
        "timezone": "America/New_York",
        "sessions": [["09:30", "16:00"]],
    },
}
RULE_SOURCE = (
    "参数为可修改的保守模拟配置，参考 SSE/SZSE 交易规则及 NYSE 核心时段；"
    "非交易所合规实现。未覆盖节假日、半日市、ST、新股、停牌、公司行为和美股 T+1 现金结算。"
    "参考 https://www.sse.com.cn/lawandrules/ https://www.szse.cn/lawrules/ "
    "https://www.nyse.com/markets/hours-calendars"
)


class MarketDataProvider(Protocol):
    def bars(self, symbol: str) -> list[PriceBar]: ...


class DemoMarketDataProvider:
    def __init__(self, db):
        self.db = db

    def bars(self, symbol):
        return list(
            self.db.scalars(select(PriceBar).where(PriceBar.symbol == symbol).order_by(PriceBar.timestamp))
        )


def selected_provider(db, demo_override=False):
    from .feeds import CachedRealProvider, market_mode

    return (
        DemoMarketDataProvider(db) if demo_override or market_mode(db) == "demo" else CachedRealProvider(db)
    )


def seed(db):
    if db.get(Account, 1):
        return
    instruments = [
        ("AAPL", "苹果", "US", "USD", "科技", "US_REGULAR", "224.50"),
        ("NVDA", "英伟达", "US", "USD", "科技", "US_REGULAR", "132.80"),
        ("MSFT", "微软", "US", "USD", "科技", "US_REGULAR", "418.20"),
        ("600519", "贵州茅台", "CN", "CNY", "消费", "CN_MAIN", "1420.00"),
        ("600036", "招商银行", "CN", "CNY", "金融", "CN_MAIN", "38.60"),
        ("300750", "宁德时代", "CN", "CNY", "新能源", "CN_GEM", "235.00"),
    ]
    for symbol, name, market, currency, sector, rule_key, price in instruments:
        db.add(
            Instrument(
                symbol=symbol, name=name, market=market, currency=currency, sector=sector, rule_key=rule_key
            )
        )
    db.flush()
    end = datetime.fromisoformat(AS_OF)
    for idx, (symbol, _, market, _, _, _, price) in enumerate(instruments):
        dates = []
        day = end
        while len(dates) < 65:
            if day.weekday() < 5:
                dates.append(day)
            day -= timedelta(days=1)
        for i, date in enumerate(reversed(dates)):
            # Deterministic synthetic series, never represented as real history.
            ratio = D("0.88") + D(i) * D("0.001875") + D((i * (idx + 3)) % 9 - 4) / D(300)
            close = (D(price) * ratio).quantize(D("0.01")) if i < 64 else D(price)
            ts = date.replace(hour=6 if market == "CN" else 18)
            db.add(
                PriceBar(
                    symbol=symbol,
                    close=close,
                    volume=1000000 + i * 17000,
                    timestamp=ts.isoformat(),
                    source=SOURCE,
                )
            )
    for id_, name, currency, cash, paper in [
        (1, "美股演示持仓", "USD", "100000", False),
        (2, "A 股演示持仓", "CNY", "1000000", False),
        (3, "美元模拟账户", "USD", "100000", True),
        (4, "人民币模拟账户", "CNY", "1000000", True),
    ]:
        db.add(Account(id=id_, name=name, currency=currency, initial_cash=D(cash), paper=paper))
    db.add(FXRate(pair="USDCNY", rate=D("7.10"), timestamp=AS_OF, source=SOURCE))
    db.add(RiskPolicy())
    for key, rule in RULES.items():
        db.add(ExecutionRule(key=key, payload=json.dumps(rule)))
    db.flush()
    for i, (account, symbol, qty, price) in enumerate(
        [
            (1, "AAPL", 100, "242"),
            (1, "NVDA", 200, "150"),
            (1, "MSFT", 30, "400"),
            (2, "600519", 200, "1580"),
            (2, "600036", 3000, "35"),
            (2, "300750", 500, "260"),
        ]
    ):
        db.add(
            Trade(
                account_id=account,
                symbol=symbol,
                side="buy",
                quantity=D(qty),
                price=D(price),
                fee=D("5"),
                traded_at="2026-09-01T02:00:00+00:00",
                fingerprint=f"seed-{i}",
            )
        )
        db.add(Watchlist(symbol=symbol))
    db.commit()


def is_stale(timestamp, now=None):
    return ((now or datetime.now(timezone.utc)) - datetime.fromisoformat(timestamp)).total_seconds() > 86400
