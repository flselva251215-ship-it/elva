"""Decimal values stored as text: SQLite NUMERIC affinity would round through float."""

from datetime import datetime, timezone
from decimal import Decimal
import os
from pathlib import Path

from sqlalchemy import Boolean, ForeignKey, Integer, String, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.types import TypeDecorator


def utcnow():
    return datetime.now(timezone.utc).isoformat()


class Money(TypeDecorator):
    impl = String(80)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return str(Decimal(value)) if value is not None else None

    def process_result_value(self, value, dialect):
        return Decimal(value) if value is not None else None


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    currency: Mapped[str]
    initial_cash: Mapped[Decimal] = mapped_column(Money)
    paper: Mapped[bool] = mapped_column(Boolean, default=False)


class Instrument(Base):
    __tablename__ = "instruments"
    symbol: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    market: Mapped[str]
    currency: Mapped[str]
    sector: Mapped[str]
    rule_key: Mapped[str]


class Trade(Base):
    __tablename__ = "trades"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    symbol: Mapped[str] = mapped_column(ForeignKey("instruments.symbol"))
    side: Mapped[str]
    quantity: Mapped[Decimal] = mapped_column(Money)
    price: Mapped[Decimal] = mapped_column(Money)
    fee: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    traded_at: Mapped[str]
    fingerprint: Mapped[str] = mapped_column(String, unique=True)
    paper_order_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PriceBar(Base):
    __tablename__ = "price_bars"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(ForeignKey("instruments.symbol"))
    close: Mapped[Decimal] = mapped_column(Money)
    volume: Mapped[int]
    timestamp: Mapped[str]
    source: Mapped[str] = mapped_column(default="内置虚构演示数据 v1")


class FXRate(Base):
    __tablename__ = "fx_rates"
    pair: Mapped[str] = mapped_column(primary_key=True)
    rate: Mapped[Decimal] = mapped_column(Money)
    timestamp: Mapped[str]
    source: Mapped[str]


class FeedSettings(Base):
    __tablename__ = "feed_settings"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    mode: Mapped[str] = mapped_column(default="real")
    twelve_personal_use: Mapped[bool] = mapped_column(default=False)
    akshare_personal_use: Mapped[bool] = mapped_column(default=False)
    akshare_license_reference: Mapped[str] = mapped_column(default="")


class FeedCache(Base):
    __tablename__ = "feed_cache"
    key: Mapped[str] = mapped_column(primary_key=True)
    provider: Mapped[str]
    payload: Mapped[str | None] = mapped_column(nullable=True)
    fetched_at: Mapped[str | None] = mapped_column(nullable=True)
    attempted_at: Mapped[str | None] = mapped_column(nullable=True)
    retry_after: Mapped[str | None] = mapped_column(nullable=True)
    error: Mapped[str | None] = mapped_column(nullable=True)


class FeedRequest(Base):
    __tablename__ = "feed_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str]
    attempted_at: Mapped[str] = mapped_column(default=utcnow)


class Watchlist(Base):
    __tablename__ = "watchlist"
    symbol: Mapped[str] = mapped_column(ForeignKey("instruments.symbol"), primary_key=True)


class RiskPolicy(Base):
    __tablename__ = "risk_policy"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    single_limit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0.35"))
    sector_limit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0.55"))
    max_loss: Mapped[Decimal] = mapped_column(Money, default=Decimal("0.15"))
    cash_floor: Mapped[Decimal] = mapped_column(Money, default=Decimal("0.10"))
    order_limit: Mapped[Decimal] = mapped_column(Money, default=Decimal("100000"))


class ExecutionRule(Base):
    __tablename__ = "execution_rules"
    key: Mapped[str] = mapped_column(primary_key=True)
    payload: Mapped[str]


class AnalysisReport(Base):
    __tablename__ = "analysis_reports"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[str] = mapped_column(default=utcnow)
    kind: Mapped[str]
    payload: Mapped[str]


class PaperOrder(Base):
    __tablename__ = "paper_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    symbol: Mapped[str] = mapped_column(ForeignKey("instruments.symbol"))
    side: Mapped[str]
    quantity: Mapped[Decimal] = mapped_column(Money)
    status: Mapped[str] = mapped_column(default="pending")
    created_at: Mapped[str] = mapped_column(default=utcnow)
    executed_at: Mapped[str | None] = mapped_column(nullable=True)
    fill_price: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    fee: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    reason: Mapped[str | None] = mapped_column(nullable=True)
    note: Mapped[str] = mapped_column(default="")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[str] = mapped_column(default=utcnow)
    action: Mapped[str]
    detail: Mapped[str]


def make_engine(path=None):
    path = path or os.getenv("STOCKPILOT_DB", "data/stockpilot.db")
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 20})

    @event.listens_for(engine, "connect")
    def configure(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")

    return engine


def sessions(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)
