"""External read-only market data. No execution/broker endpoints and no synthetic fallback."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
import importlib.util
import json
import os
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text

from .models import FeedCache, FeedRequest, FeedSettings, Instrument, utcnow

D = Decimal
TWELVE_MINUTE_BUDGET = 4
TWELVE_DAILY_BUDGET = 500
REFRESH_SECONDS = 900
SUCCESS_TTL = 21600
ERROR_BACKOFF = 300
SOURCE_NAMES = {
    "twelve": "Twelve Data · 美股日线",
    "akshare": "AKShare / 东方财富 · A股日线",
    "fx": "Frankfurter / ECB · USD/CNY日参考汇率",
}


class FeedError(ValueError):
    """Safe human-readable messages only: never echo an upstream URL, key, body or exception."""


def preferences(db):
    return db.get(FeedSettings, 1)


def market_mode(db):
    settings = preferences(db)
    return settings.mode if settings else "real"


def valid_number(raw, positive=True):
    try:
        value = D(str(raw))
    except (InvalidOperation, TypeError, ValueError):
        raise FeedError("上游返回无效数值") from None
    if not value.is_finite() or value > D("1000000000000") or (value <= 0 if positive else value < 0):
        raise FeedError("上游返回非正价格、异常数值或缺失值")
    if value.as_tuple().exponent < -12 or len(value.as_tuple().digits) > 28:
        raise FeedError("上游数值精度异常，已拒绝")
    return value


def request_json(url, headers=None):
    req = Request(
        url, headers={"User-Agent": "AIStockPilot/0.3 (private personal research)", **(headers or {})}
    )
    try:
        with urlopen(req, timeout=6) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                raise FeedError("行情响应过大，已拒绝")
            return json.loads(body, parse_float=D)
    except HTTPError as exc:
        messages = {
            401: "行情密钥未授权或已失效",
            403: "网络策略、数据授权或上游访问被拒绝",
            429: "供应商额度或频率超限；稍后重试",
        }
        raise FeedError(messages.get(exc.code, f"行情服务HTTP {exc.code}，保留已有缓存")) from None
    except (URLError, TimeoutError, OSError):
        raise FeedError("网络不可达、策略阻止或超时；未取得新行情") from None
    except (json.JSONDecodeError, UnicodeError):
        raise FeedError("行情服务返回非JSON数据") from None


def daily_bars(rows, *, day_key, close_key, volume_key, zone, volume_multiplier=1):
    bars, dates = [], set()
    today = datetime.now(timezone.utc).astimezone(ZoneInfo(zone)).date()
    for row in rows:
        try:
            day = date.fromisoformat(str(row[day_key])[:10])
        except (ValueError, KeyError, TypeError):
            raise FeedError("行情缺少有效交易日期") from None
        if day > today or day in dates:
            raise FeedError("行情日期重复或来自未来，已拒绝")
        dates.add(day)
        close = valid_number(row.get(close_key))
        raw_volume = row.get(volume_key)
        volume = (
            valid_number(raw_volume, positive=False) * volume_multiplier if raw_volume is not None else None
        )
        if volume is not None and volume != volume.to_integral_value():
            raise FeedError("成交量单位无法确认，已拒绝")
        # Date-only vendor bars are NOT claimed to have an actual midnight tick timestamp.
        anchor = datetime.combine(day, time.min, ZoneInfo(zone)).isoformat()
        bars.append(
            {
                "timestamp": anchor,
                "date": day.isoformat(),
                "close": str(close),
                "volume": int(volume) if volume is not None else None,
            }
        )
    if not bars:
        raise FeedError("供应商返回空行情")
    return sorted(bars, key=lambda x: x["date"])[-65:]


class TwelveDataProvider:
    def fetch(self, symbol):
        key = os.getenv("TWELVE_DATA_API_KEY")
        if not key:
            raise FeedError("缺少TWELVE_DATA_API_KEY，请在环境设置安全配置免费账户密钥")
        # Header authentication avoids keys in query strings, logs and error messages.
        query = urlencode(
            {
                "symbol": symbol,
                "exchange": "NASDAQ",
                "interval": "1day",
                "outputsize": 65,
                "order": "ASC",
                "timezone": "America/New_York",
                "adjust": "none",
            }
        )
        data = request_json(
            "https://api.twelvedata.com/time_series?" + query, {"Authorization": "apikey " + key}
        )
        if not isinstance(data, dict) or data.get("status") == "error":
            code = data.get("code") if isinstance(data, dict) else None
            raise FeedError(
                {
                    401: "Twelve Data密钥未授权",
                    403: "Twelve Data账户不具备此数据权限",
                    429: "Twelve Data免费额度已用完",
                }.get(code, "Twelve Data未返回可用行情；请核对账户权限与标的")
            )
        meta = data.get("meta", {})
        if (
            meta.get("symbol") != symbol
            or meta.get("currency") != "USD"
            or str(meta.get("exchange", "")).upper() != "NASDAQ"
        ):
            raise FeedError("供应商返回的股票、交易所或币种不匹配")
        bars = daily_bars(
            data.get("values", []),
            day_key="datetime",
            close_key="close",
            volume_key="volume",
            zone="America/New_York",
        )
        return quote_payload("twelve", bars, "America/New_York")


class AKShareProvider:
    def fetch(self, symbol):
        try:
            import akshare as ak
        except ImportError:
            raise FeedError("尚未安装AKShare可选依赖") from None
        try:
            # One symbol / one request, no whole-market scraping, retry loop or IP rotation.
            frame = ak.stock_zh_a_hist(
                symbol=symbol,
                period="daily",
                start_date=(date.today() - timedelta(days=140)).strftime("%Y%m%d"),
                end_date=date.today().strftime("%Y%m%d"),
                adjust="",
                timeout=6,
            )
            rows = frame.to_dict(orient="records")
        except Exception:
            raise FeedError("AKShare上游不可用或字段发生变化，保留已有缓存") from None
        if any(str(row.get("股票代码")) != symbol for row in rows):
            raise FeedError("AKShare返回的股票代码不匹配")
        # AKShare stock_zh_a_hist documents volume in lots (100 shares), not shares.
        bars = daily_bars(
            rows,
            day_key="日期",
            close_key="收盘",
            volume_key="成交量",
            zone="Asia/Shanghai",
            volume_multiplier=100,
        )
        return quote_payload("akshare", bars, "Asia/Shanghai")


def quote_payload(provider, bars, zone):
    return {
        "provider": provider,
        "source": SOURCE_NAMES[provider],
        "bars": bars,
        "timestamp_precision": "date",
        "timezone": zone,
        "as_of_date": bars[-1]["date"],
        "delay": "日线数据；供应商未提供逐笔报价时间及承诺延迟，当日数据可能未收盘",
        "adjustment": "未复权；拆股/分红未处理，不用于精确总回报",
        "real": True,
    }


class FrankfurterProvider:
    def fetch(self, symbol="USDCNY"):
        # Explicit ECB source prevents silently blending banks with different licensing/units.
        data = request_json("https://api.frankfurter.dev/v2/rates?base=USD&quotes=CNY&providers=ECB")
        if not isinstance(data, list) or not data:
            raise FeedError("Frankfurter未返回ECB USD/CNY参考汇率")
        rows = [r for r in data if r.get("base") == "USD" and r.get("quote") == "CNY"]
        if not rows:
            raise FeedError("汇率币种或来源不匹配")
        row = max(rows, key=lambda x: x.get("date", ""))
        try:
            day = date.fromisoformat(row["date"])
        except (ValueError, KeyError):
            raise FeedError("汇率缺少有效日期") from None
        if day > datetime.now(timezone.utc).date():
            raise FeedError("汇率日期来自未来")
        return {
            "provider": "fx",
            "pair": "USDCNY",
            "rate": str(valid_number(row.get("rate"))),
            "timestamp": day.isoformat() + "T00:00:00+00:00",
            "as_of_date": day.isoformat(),
            "timestamp_precision": "date",
            "source": SOURCE_NAMES["fx"],
            "real": True,
            "delay": "央行日参考汇率，非可成交外汇报价；周末/节假日可能无更新",
        }


def eligibility(db, provider):
    settings = preferences(db)
    if provider == "twelve":
        if not os.getenv("TWELVE_DATA_API_KEY"):
            return "缺少TWELVE_DATA_API_KEY（只在服务器环境设置填写）"
        if not settings or not settings.twelve_personal_use:
            return "需确认Twelve Data免费账户条款允许本人的内部非商业使用；不授予公开展示权"
    if provider == "akshare":
        if not settings or not settings.akshare_personal_use or not settings.akshare_license_reference:
            return "AKShare软件MIT许可不涵盖东方财富行情；上游个人使用授权尚未核实，默认禁用"
        if importlib.util.find_spec("akshare") is None:
            return "尚未安装AKShare可选依赖"
    return None


def cache_key(symbol, provider):
    return f"{provider}:{symbol}"


def configuration_error(message):
    return bool(message and message.startswith(("缺少", "需确认", "AKShare软件", "尚未安装")))


def cache_metadata(db, symbol, provider):
    row = db.get(FeedCache, cache_key(symbol, provider))
    payload = json.loads(row.payload) if row and row.payload else {}
    as_of = payload.get("as_of_date")
    age_days = (datetime.now(timezone.utc).date() - date.fromisoformat(as_of)).days if as_of else None
    blocked = eligibility(db, provider)
    old_error = row.error if row else None
    error = blocked or (old_error if not configuration_error(old_error) else None)
    return {
        **payload,
        "fetched_at": row.fetched_at if row else None,
        "attempted_at": row.attempted_at if row else None,
        "retry_after": row.retry_after if row else None,
        "error": error,
        "cached": bool(payload),
        "stale": age_days is None or age_days > 4,
        "age_days": age_days,
        "status": "cached_error" if payload and error else "cached" if payload else "unavailable",
    }


@dataclass
class CachedRealProvider:
    db: object

    def bars(self, symbol):
        instrument = self.db.get(Instrument, symbol)
        provider = "twelve" if instrument.market == "US" else "akshare"
        metadata = cache_metadata(self.db, symbol, provider)
        return [
            SimpleNamespace(
                close=D(b["close"]), volume=b["volume"], timestamp=b["timestamp"], source=metadata["source"]
            )
            for b in metadata.get("bars", [])
        ]


def real_fx(db):
    data = cache_metadata(db, "USDCNY", "fx")
    if not data.get("rate"):
        return None
    return SimpleNamespace(
        pair="USDCNY", rate=D(data["rate"]), timestamp=data["timestamp"], source=data["source"], metadata=data
    )


def refresh_one(db, symbol, provider):
    # Reserve in SQLite before network access; other workers/tabs see the cooldown.
    db.rollback()
    db.execute(text("BEGIN IMMEDIATE"))
    at = datetime.now(timezone.utc)
    row = db.get(FeedCache, cache_key(symbol, provider))
    if row and configuration_error(row.error) and eligibility(db, provider) is None:
        row.retry_after = None  # A newly supplied prerequisite is a meaningful state change.
        row.error = None
    if row and row.retry_after and datetime.fromisoformat(row.retry_after) > at:
        db.rollback()
        return cache_metadata(db, symbol, provider)
    if row and row.fetched_at and (at - datetime.fromisoformat(row.fetched_at)).total_seconds() < SUCCESS_TTL:
        db.commit()
        return cache_metadata(db, symbol, provider)
    error = eligibility(db, provider)
    if not error and provider == "twelve":

        def count(since):
            return db.scalar(
                select(func.count())
                .select_from(FeedRequest)
                .where(FeedRequest.provider == provider, FeedRequest.attempted_at >= since.isoformat())
            )

        if (
            count(at - timedelta(seconds=60)) >= TWELVE_MINUTE_BUDGET
            or count(at.replace(hour=0, minute=0, second=0, microsecond=0)) >= TWELVE_DAILY_BUDGET
        ):
            error = "本机保守调用预算已达上限（4次/分钟、500次/UTC日），请稍后重试"
    if not row:
        row = FeedCache(key=cache_key(symbol, provider), provider=provider)
        db.add(row)
    row.attempted_at = at.isoformat()
    row.retry_after = (at + timedelta(seconds=ERROR_BACKOFF if error else REFRESH_SECONDS)).isoformat()
    row.error = error
    if not error:
        db.add(FeedRequest(provider=provider, attempted_at=at.isoformat()))
    db.commit()
    if error:
        return cache_metadata(db, symbol, provider)
    try:
        provider_object = {
            "twelve": TwelveDataProvider,
            "akshare": AKShareProvider,
            "fx": FrankfurterProvider,
        }[provider]()
        payload = provider_object.fetch(symbol)
    except FeedError as exc:
        row = db.get(FeedCache, cache_key(symbol, provider))
        row.error = str(exc)
        row.retry_after = (datetime.now(timezone.utc) + timedelta(seconds=ERROR_BACKOFF)).isoformat()
    except Exception:
        row = db.get(FeedCache, cache_key(symbol, provider))
        row.error = "数据响应或连接异常；未替换已有缓存"
        row.retry_after = (datetime.now(timezone.utc) + timedelta(seconds=ERROR_BACKOFF)).isoformat()
    else:
        row = db.get(FeedCache, cache_key(symbol, provider))
        row.payload = json.dumps(payload, ensure_ascii=False)
        row.fetched_at = utcnow()
        row.error = None
    db.commit()
    return cache_metadata(db, symbol, provider)


def feed_status(db):
    settings = preferences(db)
    return {
        "mode": market_mode(db),
        "private_only": True,
        "auto_subscribe": False,
        "twelve_key_present": bool(os.getenv("TWELVE_DATA_API_KEY")),
        "twelve_personal_use": bool(settings and settings.twelve_personal_use),
        "akshare_personal_use": bool(settings and settings.akshare_personal_use),
        "akshare_license_reference": settings.akshare_license_reference if settings else "",
        "refresh_minutes": REFRESH_SECONDS // 60,
        "success_cache_hours": SUCCESS_TTL // 3600,
        "minute_budget": TWELVE_MINUTE_BUDGET,
        "daily_budget": TWELVE_DAILY_BUDGET,
        "budget_note": "应用自身保守上限，不是对供应商最新免费配额的承诺；实际以账户控制台为准",
        "sources": [
            {
                "provider": provider,
                "name": SOURCE_NAMES[provider],
                "blocked_reason": eligibility(db, provider),
            }
            for provider in SOURCE_NAMES
        ],
        "quotes": {
            i.symbol: cache_metadata(db, i.symbol, "twelve" if i.market == "US" else "akshare")
            for i in db.scalars(select(Instrument))
        },
        "fx": cache_metadata(db, "USDCNY", "fx"),
    }
