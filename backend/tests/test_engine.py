from datetime import datetime, timezone
from decimal import Decimal as D

import pytest

from app.engine import DomainError, average_cost, execution_constraints, indicators, portfolio
from app.market import RULES, is_stale
from app.models import FXRate, Trade


def trade(side, quantity, price, fee="0", timestamp="2026-01-02T15:00:00+00:00", id=1):
    return Trade(
        id=id, symbol="AAPL", side=side, quantity=D(quantity), price=D(price), fee=D(fee), traded_at=timestamp
    )


def test_weighted_average_cost_partial_and_full_sale():
    trades = [
        trade("buy", "10", "100", "2", id=1),
        trade("buy", "10", "120", "2", id=2),
        trade("sell", "5", "130", "1", id=3),
    ]
    cash, lots = average_cost(trades, D("10000"))
    assert cash == D("8445")
    assert lots["AAPL"] == {"quantity": D("15"), "cost": D("1653"), "realized": D("98")}
    assert lots["AAPL"]["cost"] / lots["AAPL"]["quantity"] == D("110.2")
    trades.append(trade("sell", "15", "90", "3", id=4))
    cash, lots = average_cost(trades, D("10000"))
    assert cash == D("9792")
    assert lots["AAPL"] == {"quantity": D("0"), "cost": D("0"), "realized": D("-208")}


def test_decimal_no_float_rounding():
    cash, lots = average_cost([trade("buy", "3", "0.1", "0.01")], D("1"))
    assert cash == D("0.69")
    assert lots["AAPL"]["cost"] == D("0.31")


@pytest.mark.parametrize(
    "trades,cash,message",
    [
        ([trade("sell", "1", "10")], "100", "可用持仓不足"),
        ([trade("buy", "2", "100")], "100", "现金不足"),
    ],
)
def test_ledger_invalid(trades, cash, message):
    with pytest.raises(DomainError, match=message):
        average_cost(trades, D(cash))


def test_chronological_timezones_and_equal_time_new_sell():
    buy = trade("buy", "1", "100", timestamp="2026-01-02T09:30:00-05:00", id=4)
    sell = trade("sell", "1", "101", timestamp="2026-01-02T14:30:00+00:00", id=None)
    cash, lots = average_cost([sell, buy], D("1000"))
    assert cash == D("1001") and lots["AAPL"]["quantity"] == 0


def test_usd_cny_conversion_and_account_equity_identity(db):
    data = portfolio(db)
    usd, cny = data["accounts"]
    assert usd["cash"] == D("33785")
    assert usd["market_value"] == D("61556")
    assert usd["unrealized"] == D("-4659")
    assert data["combined"]["equity"] == usd["equity"] * D("7.1") + cny["equity"]
    for a in data["accounts"]:
        assert a["equity"] == a["initial_cash"] + a["realized"] + a["unrealized"]


def test_missing_fx_does_not_merge_currencies(db):
    db.delete(db.get(FXRate, "USDCNY"))
    db.flush()
    data = portfolio(db)
    assert data["combined"]["equity"] is None
    assert data["accounts"][0]["equity"] is not None
    assert portfolio(db, 2)["combined"]["equity"] is not None


def test_decimal_roundtrip_sqlite(db):
    fx = db.get(FXRate, "USDCNY")
    fx.rate = D("7.123456789012345678901")
    db.commit()
    db.expire_all()
    assert db.get(FXRate, "USDCNY").rate == D("7.123456789012345678901")


def test_a_share_t1_and_lot_config():
    with pytest.raises(DomainError, match="交易单位"):
        execution_constraints(RULES["CN_MAIN"], D(1), "buy", D(0), D(0))
    with pytest.raises(DomainError, match=r"T\+1"):
        execution_constraints(RULES["CN_MAIN"], D(100), "sell", D(100), D(100))
    execution_constraints(RULES["CN_MAIN"], D(100), "sell", D(200), D(100))
    execution_constraints(RULES["CN_MAIN"], D(50), "sell", D(50), D(0))
    execution_constraints(RULES["US_REGULAR"], D(1), "sell", D(1), D(1))
    assert RULES["CN_GEM"]["limit_pct"] != RULES["CN_MAIN"]["limit_pct"]


def test_staleness_and_missing_indicators():
    assert is_stale("2026-01-01T00:00:00+00:00", datetime(2026, 1, 3, tzinfo=timezone.utc))
    assert not is_stale("2026-01-01T00:00:00+00:00", datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert indicators([])["score"] is None
