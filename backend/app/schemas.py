from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

Positive = Annotated[Decimal, Field(gt=0, le=Decimal("1000000000"), max_digits=20, decimal_places=6)]
Nonnegative = Annotated[Decimal, Field(ge=0, le=Decimal("1000000000"), max_digits=20, decimal_places=6)]
Ratio = Annotated[Decimal, Field(gt=0, le=1)]


class TradeInput(BaseModel):
    account_id: int = Field(gt=0)
    symbol: str = Field(min_length=1, max_length=12, pattern=r"^[A-Z0-9.]+$")
    side: Literal["buy", "sell"]
    quantity: Positive
    price: Positive
    fee: Nonnegative = Decimal(0)
    traded_at: datetime

    @field_validator("traded_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("成交时间必须包含时区，如 2026-10-16T14:00:00+08:00")
        return value


class OrderInput(BaseModel):
    account_id: int = Field(gt=0)
    symbol: str = Field(min_length=1, max_length=12, pattern=r"^[A-Z0-9.]+$")
    side: Literal["buy", "sell"]
    quantity: Positive
    note: str = Field(default="", max_length=500)


class FillInput(BaseModel):
    demo_clock: bool = False


class PolicyInput(BaseModel):
    single_limit: Ratio
    sector_limit: Ratio
    max_loss: Ratio
    cash_floor: Annotated[Decimal, Field(ge=0, le=1)]
    order_limit: Positive


class CSVInput(BaseModel):
    content: str = Field(max_length=1000000)
    dry_run: bool = True


class FeedInput(BaseModel):
    mode: Literal["real", "demo"] = "real"
    twelve_personal_use: bool = False
    akshare_personal_use: bool = False
    akshare_license_reference: str = Field(default="", max_length=500)

    @field_validator("akshare_license_reference")
    @classmethod
    def source_reference(cls, value):
        if value:
            from urllib.parse import urlparse

            url = urlparse(value)
            if (
                url.scheme != "https"
                or url.hostname not in {"eastmoney.com", "www.eastmoney.com", "quote.eastmoney.com"}
                or url.username
                or url.password
            ):
                raise ValueError("请填写东方财富官方HTTPS授权条款链接，不能用AKShare的MIT许可代替")
        return value


class RuleInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    lot: int = Field(ge=1, le=10000)
    t_plus: Literal[0, 1]
    limit_pct: Ratio | None
    fee_rate: Annotated[Decimal, Field(ge=0, le=Decimal("0.1"))]
    min_fee: Nonnegative
    sell_tax: Annotated[Decimal, Field(ge=0, le=Decimal("0.1"))]
    slippage: Annotated[Decimal, Field(ge=0, le=Decimal("0.05"))]
    volume_fraction: Ratio
    timezone: Literal["Asia/Shanghai", "America/New_York"]
    sessions: list[tuple[str, str]] = Field(min_length=1, max_length=4)

    @field_validator("sessions")
    @classmethod
    def valid_sessions(cls, value):
        from datetime import time

        previous_end = "00:00"
        for start, end in value:
            time.fromisoformat(start)
            time.fromisoformat(end)
            if len(start) != 5 or len(end) != 5 or not previous_end <= start < end:
                raise ValueError("时段必须为 HH:MM，按顺序且不能重叠")
            previous_end = end
        return value
