from decimal import Decimal as D
from sqlalchemy import select

from app.engine import portfolio
from app.models import PriceBar


def test_daily_sample_is_not_labeled_today(db):
    data = portfolio(db)
    expected = D(0)
    for position in data["positions"]:
        bars = list(
            db.scalars(
                select(PriceBar).where(PriceBar.symbol == position["symbol"]).order_by(PriceBar.timestamp)
            )
        )
        pnl = position["quantity"] * (bars[-1].close - bars[-2].close)
        expected += pnl * (D("7.1") if position["currency"] == "USD" else D(1))
    assert data["combined"]["latest_session_pnl"] == expected
    assert data["combined"]["total_pnl"] == data["combined"]["realized"] + data["combined"]["unrealized"]
    assert data["combined"]["latest_session_date"] == "2026-10-16"


def test_session_pnl_includes_same_day_trade_and_fees(client):
    before = D(client.get("/api/positions?account_id=1").json()["accounts"][0]["latest_session_pnl"])
    response = client.post(
        "/api/trades",
        json={
            "account_id": 1,
            "symbol": "AAPL",
            "side": "buy",
            "quantity": "10",
            "price": "220",
            "fee": "1",
            "traded_at": "2026-10-16T14:00:00-04:00",
        },
    )
    assert response.status_code == 201
    after = client.get("/api/positions?account_id=1").json()["accounts"][0]
    assert D(after["latest_session_pnl"]) - before == D("44")


def test_quote_older_than_recorded_trade_does_not_invent_daily_pnl(client):
    result = client.post(
        "/api/trades",
        json={
            "account_id": 1,
            "symbol": "AAPL",
            "side": "buy",
            "quantity": "10",
            "price": "220",
            "fee": "1",
            "traded_at": "2026-10-17T14:00:00-04:00",
        },
    )
    assert result.status_code == 201
    result = client.get("/api/positions?account_id=1").json()["accounts"][0]
    assert result["latest_session_pnl"] is None
    assert result["today_pnl"] is None
