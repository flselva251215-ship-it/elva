"""Isolated fixtures test integration; they are never written to the user's real cache."""

from datetime import datetime, timedelta, timezone
import json
from decimal import Decimal as D
from unittest.mock import Mock
from urllib.error import HTTPError, URLError

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select, func

from app import feeds
from app.main import create_app
from app.models import FeedCache, FeedRequest, utcnow


@pytest.fixture
def real_client(tmp_path):
    with TestClient(create_app(str(tmp_path / "real-test.db"))) as client:
        yield client


def fixture_payload(symbol="AAPL"):
    return {
        "meta": {"symbol": symbol, "currency": "USD", "exchange": "NASDAQ"},
        "status": "ok",
        "values": [
            {"datetime": "2026-10-15", "close": "220.01", "volume": "1000000"},
            {"datetime": "2026-10-16", "close": "224.51", "volume": "2000000"},
        ],
    }


def grant_twelve(client, monkeypatch):
    monkeypatch.setenv("TWELVE_DATA_API_KEY", "fixture-only-not-a-real-credential")
    response = client.put("/api/market-data/settings", json={"mode": "real", "twelve_personal_use": True})
    assert response.status_code == 200


def test_real_is_default_never_reads_seed_prices_or_seed_fx(real_client, monkeypatch):
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    assert real_client.get("/api/health").json()["market_provider"] == "real"
    data = real_client.get("/api/positions").json()
    assert len(data["positions"]) == 6
    assert all(p["price"] is None and p["unrealized"] is None and not p["demo"] for p in data["positions"])
    assert data["combined"]["equity"] is None and data["fx"] is None
    assert real_client.get("/api/performance").json()["points"] == []
    assert real_client.get("/api/risk-analysis").status_code == 200
    assert len(real_client.get("/api/positions?paper=true").json()["accounts"]) == 2


def test_twelve_strict_values_identity_timezone_and_no_key_in_url(monkeypatch):
    monkeypatch.setenv("TWELVE_DATA_API_KEY", "fixture-only-secret")
    fetch = Mock(return_value=fixture_payload())
    monkeypatch.setattr(feeds, "request_json", fetch)
    result = feeds.TwelveDataProvider().fetch("AAPL")
    assert result["bars"][-1]["close"] == "224.51"
    assert result["timestamp_precision"] == "date"
    assert result["bars"][-1]["timestamp"] == "2026-10-16T00:00:00-04:00"
    assert "fixture-only-secret" not in fetch.call_args.args[0]
    assert fetch.call_args.args[1]["Authorization"] == "apikey fixture-only-secret"
    assert "apikey=" not in fetch.call_args.args[0]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda d: d["meta"].update(symbol="MSFT"),
        lambda d: d["meta"].update(currency="CNY"),
        lambda d: d["values"][0].update(close="NaN"),
        lambda d: d["values"][0].update(close="1e-999999"),
        lambda d: d["values"][0].update(close="0"),
        lambda d: d["values"][0].update(datetime="2099-01-01"),
        lambda d: d.update(values=[]),
        lambda d: d["values"].append(d["values"][0]),
    ],
)
def test_invalid_supplier_data_rejected(monkeypatch, mutation):
    monkeypatch.setenv("TWELVE_DATA_API_KEY", "fixture-only-secret")
    data = fixture_payload()
    mutation(data)
    monkeypatch.setattr(feeds, "request_json", lambda *args: data)
    with pytest.raises(feeds.FeedError):
        feeds.TwelveDataProvider().fetch("AAPL")


def test_upstream_errors_redacted(monkeypatch):
    def fail(req, timeout):
        raise URLError("sensitive-url?apikey=fixture-secret")

    monkeypatch.setattr(feeds, "urlopen", fail)
    with pytest.raises(feeds.FeedError) as error:
        feeds.request_json(
            "https://api.twelvedata.com/time_series", {"Authorization": "apikey fixture-secret"}
        )
    assert "fixture-secret" not in str(error.value)
    monkeypatch.setattr(
        feeds,
        "urlopen",
        lambda *args, **kwargs: (_ for _ in ()).throw(HTTPError("secret-url", 429, "secret", {}, None)),
    )
    with pytest.raises(feeds.FeedError, match="额度"):
        feeds.request_json("https://api.twelvedata.com/time_series")


def test_cache_refresh_failure_retains_price_and_original_fetched_time(real_client, monkeypatch):
    grant_twelve(real_client, monkeypatch)
    calls = []

    def get(url, headers=None):
        calls.append(url)
        if "frankfurter" in url:
            return [{"date": "2026-10-16", "base": "USD", "quote": "CNY", "rate": D("7.12345")}]
        return fixture_payload()

    monkeypatch.setattr(feeds, "request_json", get)
    real_client.post("/api/market-data/refresh?symbol=AAPL")
    first = real_client.get("/api/market-data/AAPL").json()
    assert first["price"] == "224.51" and first["demo"] is False
    real_client.post("/api/market-data/refresh?symbol=AAPL")
    assert len(calls) == 2  # One stock + FX, never refresh-per-read or duplicate calls.
    with real_client.app.state.session_factory() as db:
        row = db.get(FeedCache, "twelve:AAPL")
        row.retry_after = None
        row.fetched_at = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        old_fetched = row.fetched_at
        db.commit()
    monkeypatch.setattr(feeds, "request_json", Mock(side_effect=feeds.FeedError("供应商暂不可用")))
    real_client.post("/api/market-data/refresh?symbol=AAPL")
    after = real_client.get("/api/market-data/AAPL").json()
    assert after["price"] == "224.51"
    assert after["provenance"]["fetched_at"] == old_fetched
    assert after["provenance"]["error"] == "供应商暂不可用"
    assert after["provenance"]["status"] == "cached_error"


def test_real_valuation_and_fx_uses_only_verified_fixture_payload(real_client, monkeypatch):
    grant_twelve(real_client, monkeypatch)

    def get(url, headers=None):
        if "frankfurter" in url:
            return [{"date": "2026-10-16", "base": "USD", "quote": "CNY", "rate": "7.11111"}]
        from urllib.parse import parse_qs, urlparse

        symbol = parse_qs(urlparse(url).query)["symbol"][0]
        return fixture_payload(symbol)

    monkeypatch.setattr(feeds, "request_json", get)
    real_client.post("/api/market-data/refresh")
    data = real_client.get("/api/positions?account_id=1").json()
    mv = D("224.51") * D(330)
    assert D(data["accounts"][0]["market_value"]) == mv
    assert D(data["accounts"][0]["equity"]) == D("33785") + mv
    assert D(data["combined"]["equity"]) == (D("33785") + mv) * D("7.11111")
    all_accounts = real_client.get("/api/positions").json()
    assert all_accounts["combined"]["equity"] is None  # CN unavailable must not become zero/demo.
    curve = real_client.get("/api/performance?account_id=1").json()
    assert curve["demo"] is False and len(curve["points"]) == 2
    assert D(curve["points"][-1]["equity"]) == D(data["accounts"][0]["equity"])


def test_missing_key_and_unconfirmed_rights_never_call_supplier(real_client, monkeypatch):
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    mocked = Mock(side_effect=feeds.FeedError("网络被阻止"))
    monkeypatch.setattr(feeds, "request_json", mocked)
    status = real_client.post("/api/market-data/refresh").json()
    assert mocked.call_count == 1  # Only the public, no-key FX service is attempted.
    assert status["quotes"]["AAPL"]["cached"] is False
    assert "TWELVE_DATA_API_KEY" in status["quotes"]["AAPL"]["error"]
    assert "许可" in status["quotes"]["600519"]["error"] or "授权" in status["quotes"]["600519"]["error"]
    assert "fixture-only" not in json.dumps(status)


def test_request_budget_survives_sessions_and_cannot_be_bypassed(real_client, monkeypatch):
    grant_twelve(real_client, monkeypatch)
    with real_client.app.state.session_factory() as db:
        for _ in range(4):
            db.add(FeedRequest(provider="twelve", attempted_at=utcnow()))
        db.commit()
    mocked = Mock(side_effect=feeds.FeedError("外部失败"))
    monkeypatch.setattr(feeds, "request_json", mocked)
    result = real_client.post("/api/market-data/refresh?symbol=AAPL").json()
    assert "预算" in result["quotes"]["AAPL"]["error"]
    assert mocked.call_count == 1  # FX only, no US request exceeds budget.
    with real_client.app.state.session_factory() as db:
        assert (
            db.scalar(select(func.count()).select_from(FeedRequest).where(FeedRequest.provider == "twelve"))
            == 4
        )


def test_akshare_rights_reference_required_and_volume_unit_conversion(real_client, monkeypatch):
    result = real_client.put("/api/market-data/settings", json={"mode": "real", "akshare_personal_use": True})
    assert result.status_code == 400
    result = real_client.put(
        "/api/market-data/settings",
        json={
            "mode": "real",
            "akshare_personal_use": True,
            "akshare_license_reference": "https://github.com/akfamily/akshare/LICENSE",
        },
    )
    assert result.status_code == 422
    import akshare
    import pandas as pd

    monkeypatch.setattr(
        akshare,
        "stock_zh_a_hist",
        lambda **kwargs: pd.DataFrame(
            [{"日期": "2026-10-16", "股票代码": "600036", "收盘": 38.6, "成交量": 1234}]
        ),
    )
    data = feeds.AKShareProvider().fetch("600036")
    assert data["bars"][0]["volume"] == 123400
    assert data["bars"][0]["close"] == "38.6"
    assert data["source"].startswith("AKShare / 东方财富")


def test_daily_budget_and_persistent_error_backoff(real_client, monkeypatch):
    grant_twelve(real_client, monkeypatch)
    monkeypatch.setattr(feeds, "TWELVE_MINUTE_BUDGET", 1001)
    with real_client.app.state.session_factory() as db:
        for _ in range(500):
            db.add(FeedRequest(provider="twelve", attempted_at=utcnow()))
        db.commit()
    mocked = Mock(side_effect=feeds.FeedError("外部失败"))
    monkeypatch.setattr(feeds, "request_json", mocked)
    result = real_client.post("/api/market-data/refresh?symbol=AAPL").json()
    assert "预算" in result["quotes"]["AAPL"]["error"]
    assert mocked.call_count == 1
    result = real_client.post("/api/market-data/refresh?symbol=AAPL").json()
    assert mocked.call_count == 1
    assert result["quotes"]["AAPL"]["retry_after"] is not None


def test_new_credential_unblocks_configuration_error_without_bypassing_network_backoff(
    real_client, monkeypatch
):
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    monkeypatch.setattr(feeds, "request_json", Mock(side_effect=feeds.FeedError("网络被阻止")))
    real_client.post("/api/market-data/refresh?symbol=AAPL")
    grant_twelve(real_client, monkeypatch)
    monkeypatch.setattr(feeds, "request_json", Mock(return_value=fixture_payload()))
    result = real_client.post("/api/market-data/refresh?symbol=AAPL").json()
    assert result["quotes"]["AAPL"]["cached"] is True
    assert result["quotes"]["AAPL"]["error"] is None


def test_frankfurter_pair_and_date_checks(monkeypatch):
    monkeypatch.setattr(
        feeds,
        "request_json",
        lambda *a: [{"date": "2026-10-16", "base": "USD", "quote": "CNY", "rate": "7.111111"}],
    )
    assert feeds.FrankfurterProvider().fetch()["rate"] == "7.111111"
    monkeypatch.setattr(
        feeds,
        "request_json",
        lambda *a: [{"date": "2026-10-16", "base": "EUR", "quote": "CNY", "rate": "7.111111"}],
    )
    with pytest.raises(feeds.FeedError, match="币种"):
        feeds.FrankfurterProvider().fetch()
