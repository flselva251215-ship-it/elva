from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D

import pytest
from sqlalchemy import select

from app.models import PriceBar, Trade


def payload(**changes):
    return {
        "account_id": 1,
        "symbol": "AAPL",
        "side": "buy",
        "quantity": "10",
        "price": "220",
        "fee": "1",
        "traded_at": "2026-10-15T10:00:00-04:00",
        **changes,
    }


def place(client, **changes):
    response = client.post(
        "/api/paper-orders",
        json={"account_id": 3, "symbol": "AAPL", "side": "buy", "quantity": "10", **changes},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def fill(client, order_id, demo=True):
    response = client.post(f"/api/paper-orders/{order_id}/fill", json={"demo_clock": demo})
    assert response.status_code == 200, response.text
    return response.json()


def test_demo_health_data_and_market(client):
    assert client.get("/api/health").json()["live_trading"] is False
    assert len(client.get("/api/positions").json()["positions"]) == 6
    stock = client.get("/api/market-data/AAPL").json()
    assert len(stock["bars"]) == 65 and stock["demo"] is True
    assert "虚构" in stock["source"] and stock["valuation"] is None
    assert stock["metrics"]["ma20"] is not None
    assert client.get("/api/market-data?q=茅台").json()[0]["symbol"] == "600519"
    assert len(client.get("/api/market-data?market=CN").json()) == 3
    assert client.get("/api/market-data/UNKNOWN").status_code == 400


def test_trade_add_edit_delete_and_duplicates(client):
    original = client.get("/api/positions?account_id=1").json()
    result = client.post("/api/trades", json=payload())
    assert result.status_code == 201
    id_ = result.json()["id"]
    assert result.json()["price"] == "220"
    assert client.post("/api/trades", json=payload(quantity="10.00")).status_code == 400
    assert client.put(f"/api/trades/{id_}", json=payload(price="221")).status_code == 200
    position = next(p for p in client.get("/api/positions").json()["positions"] if p["symbol"] == "AAPL")
    assert D(position["quantity"]) == 110
    assert client.delete(f"/api/trades/{id_}").status_code == 400
    assert client.delete(f"/api/trades/{id_}?confirm=true").status_code == 200
    assert client.get("/api/positions?account_id=1").json() == original


@pytest.mark.parametrize(
    "changes,code",
    [
        ({"quantity": "-1"}, 422),
        ({"quantity": "NaN"}, 422),
        ({"price": "Infinity"}, 422),
        ({"fee": "-1"}, 422),
        ({"side": "dividend"}, 422),
        ({"quantity": "0.0000001"}, 422),
        ({"traded_at": "2026-01-01T12:00:00"}, 422),
        ({"traded_at": "2099-01-01T12:00:00Z"}, 400),
        ({"symbol": "600036"}, 400),
        ({"account_id": 3}, 400),
        ({"account_id": 999}, 400),
        ({"side": "sell", "quantity": "999999"}, 400),
    ],
)
def test_trade_validation(client, changes, code):
    assert client.post("/api/trades", json=payload(**changes)).status_code == code


def test_delete_buy_cannot_break_later_sell(client):
    result = client.post("/api/trades", json=payload(side="sell", quantity="100", price="220"))
    assert result.status_code == 201
    assert client.delete("/api/trades/1?confirm=true").status_code == 400
    assert len(client.get("/api/positions").json()["positions"]) == 5


def test_csv_dry_run_duplicates_atomic_and_errors(client):
    text = client.get("/api/trades/template.csv").text
    before = len(client.get("/api/trades").json())
    preview = client.post("/api/trades/import", json={"content": text}).json()
    assert preview["accepted"] == 1 and preview["dry_run"]
    assert len(client.get("/api/trades").json()) == before
    imported = client.post("/api/trades/import", json={"content": text, "dry_run": False}).json()
    assert imported["accepted"] == 1
    duplicate = client.post("/api/trades/import", json={"content": text, "dry_run": False}).json()
    assert duplicate["duplicates"] == [2] and duplicate["accepted"] == 0
    bad = text.replace(",220,", ",221,") + "1,AAPL,buy,-2,100,0,2026-10-15T12:00:00Z\n"
    result = client.post("/api/trades/import", json={"content": bad, "dry_run": False}).json()
    assert result["errors"][0]["line"] == 3 and result["accepted"] == 0
    assert len(client.get("/api/trades").json()) == before + 1


def test_csv_unsorted_and_duplicate_in_same_file(client):
    header = "account_id,symbol,side,quantity,price,fee,traded_at\n"
    buy = "1,AAPL,buy,200,10,0,2026-10-01T12:00:00Z\n"
    sell = "1,AAPL,sell,250,11,0,2026-10-02T12:00:00Z\n"
    result = client.post(
        "/api/trades/import", json={"content": header + sell + buy + buy, "dry_run": False}
    ).json()
    assert result["accepted"] == 2 and result["duplicates"] == [4] and not result["errors"]


def test_csv_bad_header_and_timezone(client):
    assert client.post("/api/trades/import", json={"content": "bad,header\n"}).status_code == 400
    text = client.get("/api/trades/template.csv").text.replace("-04:00", "")
    assert client.post("/api/trades/import", json={"content": text}).json()["errors"][0]["line"] == 2


def test_paper_roundtrip_buy_sell_fees_and_account_isolation(client):
    original = client.get("/api/positions").json()
    buy = fill(client, place(client))
    assert buy["status"] == "filled" and buy["fill_price"] == "224.61"
    sell = fill(client, place(client, side="sell"))
    assert sell["status"] == "filled" and sell["fill_price"] == "224.39"
    paper = client.get("/api/positions?paper=true&account_id=3").json()
    assert not paper["positions"]
    assert D(paper["accounts"][0]["realized"]) == D("-4.20")
    assert D(paper["accounts"][0]["cash"]) == D("99995.80")
    assert client.get("/api/positions").json() == original
    assert client.post(f"/api/paper-orders/{buy['id']}/fill", json={"demo_clock": True}).status_code == 400
    paper_trade = client.get("/api/trades?account_id=3").json()[0]
    assert client.delete(f"/api/trades/{paper_trade['id']}?confirm=true").status_code == 400


def test_paper_concurrent_fill_once(client):
    order = place(client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: client.post(
                    f"/api/paper-orders/{order}/fill", json={"demo_clock": True}
                ).status_code,
                range(2),
            )
        )
    assert sorted(responses) == [200, 400]
    assert len(client.get("/api/trades?account_id=3").json()) == 1


def test_paper_cancellation_state_machine(client):
    order = place(client)
    assert client.post(f"/api/paper-orders/{order}/cancel").json()["status"] == "cancelled"
    assert client.post(f"/api/paper-orders/{order}/cancel").status_code == 400
    assert client.post(f"/api/paper-orders/{order}/fill", json={"demo_clock": True}).status_code == 400


def test_paper_t1_and_whole_lot(client):
    bad = fill(client, place(client, account_id=4, symbol="600036", quantity="1"))
    assert bad["status"] == "rejected" and "交易单位" in bad["reason"]
    buy = fill(client, place(client, account_id=4, symbol="600036", quantity="100"))
    assert buy["status"] == "filled"
    sell = fill(client, place(client, account_id=4, symbol="600036", quantity="100", side="sell"))
    assert sell["status"] == "rejected" and "T+1" in sell["reason"]


def test_cn_previous_local_day_can_sell(client, db):
    db.add(
        Trade(
            account_id=4,
            symbol="600036",
            side="buy",
            quantity=D(100),
            price=D(38),
            fee=D(5),
            traded_at="2026-10-15T06:00:00+00:00",
            fingerprint="previous-day-paper",
        )
    )
    db.commit()
    result = fill(client, place(client, account_id=4, symbol="600036", quantity="100", side="sell"))
    assert result["status"] == "filled"
    assert D(result["fee"]) > 5  # includes simulated sell tax


def test_cn_t1_uses_exchange_local_day(client, db):
    db.add(
        Trade(
            account_id=4,
            symbol="600036",
            side="buy",
            quantity=D(100),
            price=D(38),
            fee=D(5),
            traded_at="2026-10-15T20:00:00+00:00",
            fingerprint="same-china-day-paper",
        )
    )
    db.commit()
    result = fill(client, place(client, account_id=4, symbol="600036", quantity="100", side="sell"))
    assert result["status"] == "rejected" and "T+1" in result["reason"]


def test_distinct_pending_orders_recheck_cash_and_reject_short_sell(client):
    first, second = place(client, quantity="300"), place(client, quantity="300")
    assert fill(client, first)["status"] == "filled"
    result = fill(client, second)
    assert result["status"] == "rejected" and "现金不足" in result["reason"]
    result = fill(client, place(client, side="sell", quantity="301"))
    assert result["status"] == "rejected" and "可卖数量不足" in result["reason"]


def test_paper_price_band_and_missing_market_data(client, db):
    bars = list(db.scalars(select(PriceBar).where(PriceBar.symbol == "600036").order_by(PriceBar.timestamp)))
    bars[-1].close *= 2
    db.commit()
    result = fill(client, place(client, account_id=4, symbol="600036", quantity="100"))
    assert result["status"] == "rejected" and "涨跌幅" in result["reason"]
    for bar in db.scalars(select(PriceBar).where(PriceBar.symbol == "NVDA")):
        db.delete(bar)
    db.commit()
    portfolio = client.get("/api/positions").json()
    assert portfolio["combined"]["equity"] is None
    assert any("行情" in a["message"] for a in client.get("/api/risk-analysis").json()["alerts"])
    result = fill(client, place(client, symbol="NVDA"))
    assert result["status"] == "rejected" and "行情缺失" in result["reason"]


def test_paper_enforces_limits_currency_and_cash_floor(client):
    assert (
        client.post(
            "/api/paper-orders", json={"account_id": 1, "symbol": "AAPL", "side": "buy", "quantity": "1"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/paper-orders", json={"account_id": 3, "symbol": "600036", "side": "buy", "quantity": "100"}
        ).status_code
        == 400
    )
    policy = client.get("/api/risk-policy").json()
    policy["order_limit"] = "100"
    assert client.put("/api/risk-policy", json=policy).status_code == 200
    result = fill(client, place(client))
    assert result["status"] == "rejected" and "上限" in result["reason"]
    policy.update(order_limit="1000000", cash_floor="0.99")
    client.put("/api/risk-policy", json=policy)
    result = fill(client, place(client))
    assert result["status"] == "rejected" and "现金底线" in result["reason"]


def test_paper_stale_requires_explicit_demo_consent(client, db):
    # Move all samples back; no conditional test or dependence on the host weekday.
    from datetime import datetime

    for bar in db.scalars(select(PriceBar).where(PriceBar.symbol == "AAPL")):
        bar.timestamp = datetime.fromisoformat(bar.timestamp).replace(year=2000).isoformat()
    db.commit()
    result = fill(client, place(client), demo=False)
    assert result["status"] == "rejected" and "过期" in result["reason"]


def test_risk_policy_scenarios_and_stress(client):
    p = client.get("/api/risk-policy").json()
    p.update(single_limit="0.01", sector_limit="0.01", max_loss="0.01")
    assert client.put("/api/risk-policy", json=p).status_code == 200
    risk = client.get("/api/risk-analysis").json()
    assert any("单股" in a["message"] for a in risk["alerts"])
    assert any("行业" in a["message"] for a in risk["alerts"])
    diagnostic = next(x for x in risk["diagnostics"] if x["symbol"] == "AAPL")
    assert diagnostic["risk_score"] >= 70
    assert len(diagnostic["scenarios"]) == 3 and "公式" not in diagnostic["formula"]
    assert D(diagnostic["scenarios"][2]["down_10_loss"]) < 0  # exit still has costs
    mv = D(client.get("/api/positions").json()["combined"]["market_value"])
    assert D(risk["stress"][1]["change_cny"]) == -mv * D("0.1")
    p["single_limit"] = "1.1"
    assert client.put("/api/risk-policy", json=p).status_code == 422


def test_rules_change_restricts_hours_and_volume(client):
    rules = client.get("/api/execution-rules").json()["rules"]
    rule = rules["US_REGULAR"]
    rule["sessions"] = [["09:30", "10:00"]]
    assert client.put("/api/execution-rules/US_REGULAR", json=rule).status_code == 200
    result = fill(client, place(client))
    assert result["status"] == "rejected" and "时段" in result["reason"]
    rule["sessions"] = [["09:30", "16:00"]]
    rule["volume_fraction"] = "0.000001"
    client.put("/api/execution-rules/US_REGULAR", json=rule)
    result = fill(client, place(client))
    assert result["status"] == "rejected" and "成交量" in result["reason"]
    rule["sessions"] = [["16:00", "09:30"]]
    assert client.put("/api/execution-rules/US_REGULAR", json=rule).status_code == 422


def test_reports_watchlist_audit_export(client):
    client.delete("/api/watchlist/AAPL")
    assert "AAPL" not in client.get("/api/watchlist").json()
    client.put("/api/watchlist/AAPL")
    assert "AAPL" in client.get("/api/watchlist").json()
    report = client.post("/api/reports?kind=weekly").json()
    assert "portfolio" in report["payload"] and "risk" in report["payload"]
    assert client.get("/api/reports").json()[0]["id"] == report["id"]
    assert "unrealized" in client.get("/api/reports/export.csv").text
    assert client.get("/api/audit-logs").json()[0]["action"] == "report_created"
    assert client.get("/api/reports?limit=0").status_code == 422


def test_no_live_routes_and_cross_site_writes_rejected(client):
    for path in ["/api/live-orders", "/api/broker/connect", "/api/real-trading"]:
        assert client.post(path, json={}).status_code == 404
    assert (
        client.post("/api/trades", json=payload(), headers={"Origin": "https://evil.example"}).status_code
        == 403
    )
    assert client.get("/api/accounts", headers={"Host": "evil.example"}).status_code == 403
