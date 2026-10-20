import csv
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
from io import StringIO
import json
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from .engine import (
    DomainError,
    audit,
    average_cost,
    fill_paper_order,
    fingerprint,
    ledger,
    market_detail,
    portfolio,
    risk_analysis,
    rules_response,
    equity_history,
)
from .feeds import configuration_error, eligibility, feed_status, market_mode, refresh_one
from .market import SOURCE, seed
from .models import (
    Account,
    AnalysisReport,
    AuditLog,
    Base,
    ExecutionRule,
    FeedCache,
    FeedSettings,
    Instrument,
    PaperOrder,
    RiskPolicy,
    Trade,
    Watchlist,
    make_engine,
    sessions,
)
from .schemas import CSVInput, FeedInput, FillInput, OrderInput, PolicyInput, RuleInput, TradeInput


def serial(value):
    """All monetary decimals cross the API as strings, never rounded JSON floats."""
    return jsonable_encoder(value, custom_encoder={Decimal: str})


def record(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def create_app(database_path=None, seed_demo=True, data_mode=None):
    engine = make_engine(database_path)
    factory = sessions(engine)

    @asynccontextmanager
    async def lifespan(app):
        Base.metadata.create_all(engine)
        if seed_demo:
            with factory() as db:
                seed(db)
        with factory() as db:
            if not db.get(FeedSettings, 1):
                db.add(FeedSettings(id=1, mode=data_mode or os.getenv("STOCKPILOT_MARKET_MODE", "real")))
                db.commit()
        yield
        engine.dispose()

    app = FastAPI(title="AI StockPilot · 仅模拟", version="0.1.0", lifespan=lifespan)
    app.state.session_factory = factory

    def db_session():
        with factory() as db:
            yield db

    @app.middleware("http")
    async def local_access(request: Request, call_next):
        # Single-user local tool. Same-origin only; never trust forwarded headers.
        host = request.headers.get("host", "").split(":")[0]
        if host not in {"localhost", "127.0.0.1", "testserver"}:
            return JSONResponse({"detail": "MVP 仅允许本机访问；公开部署前需增加鉴权和 TLS"}, status_code=403)
        if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
            origin = request.headers.get("origin")
            if origin and origin not in {
                f"http://{request.headers.get('host')}",
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            }:
                return JSONResponse({"detail": "拒绝跨站写入请求"}, status_code=403)
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "拒绝跨站请求"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(IntegrityError)
    async def duplicate_error(request, exc):
        return JSONResponse({"detail": "重复交易或关联数据冲突；本次修改未保存"}, status_code=409)

    def write_lock(db):
        # Serializes read/validate/write across workers, not just Python threads.
        db.execute(text("BEGIN IMMEDIATE"))

    def account_instrument(db, account_id, symbol, paper=False):
        account, instrument = db.get(Account, account_id), db.get(Instrument, symbol)
        if not account or account.paper != paper:
            raise DomainError("请选择对应的虚拟账户" if paper else "请选择持仓记录账户（非模拟账户）")
        if not instrument:
            raise DomainError("未知股票；MVP 仅支持内置演示标的")
        if account.currency != instrument.currency:
            raise DomainError("股票币种与账户不匹配，不能隐式换汇")
        return account, instrument

    def make_trade(db, data, existing=None):
        account, _ = account_instrument(db, data.account_id, data.symbol)
        if data.traded_at > datetime.now(timezone.utc):
            raise DomainError("成交时间不能晚于当前时间")
        fp = fingerprint(data)
        duplicate = db.scalar(select(Trade).where(Trade.fingerprint == fp))
        if duplicate and (existing is None or duplicate.id != existing.id):
            raise DomainError("检测到重复交易，未再次导入")
        fields = data.model_dump(exclude={"traded_at"})
        fields["traded_at"] = data.traded_at.astimezone(timezone.utc).isoformat()
        fields["fingerprint"] = fp
        candidate = Trade(**fields)
        _, _, _, trades = ledger(db, account.id)
        if existing:
            if existing.paper_order_id:
                raise DomainError("模拟成交不可修改；请通过后续模拟交易调整")
            if existing.account_id != data.account_id:
                raise DomainError("修改交易不能迁移账户")
            trades = [t for t in trades if t.id != existing.id]
            candidate.id = existing.id
        average_cost([*trades, candidate], account.initial_cash)
        if existing:
            for key, value in fields.items():
                setattr(existing, key, value)
            return existing
        db.add(candidate)
        return candidate

    @app.get("/api/health")
    def health(db=Depends(db_session)):
        return {
            "status": "ok",
            "mode": "paper-only",
            "live_trading": False,
            "market_provider": market_mode(db),
            "ai_engine": "rules",
        }

    @app.get("/api/accounts")
    def accounts(db=Depends(db_session)):
        return serial([record(a) for a in db.scalars(select(Account).order_by(Account.id))])

    @app.get("/api/positions")
    def positions(account_id: int | None = None, paper: bool = False, db=Depends(db_session)):
        return serial(portfolio(db, account_id, paper))

    @app.get("/api/trades")
    def trades(
        account_id: int | None = None,
        offset: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db=Depends(db_session),
    ):
        query = select(Trade)
        if account_id is not None:
            query = query.where(Trade.account_id == account_id)
        return serial(
            [
                record(t)
                for t in db.scalars(
                    query.order_by(Trade.traded_at.desc(), Trade.id.desc()).offset(offset).limit(limit)
                )
            ]
        )

    @app.post("/api/trades", status_code=201)
    def add_trade(data: TradeInput, db=Depends(db_session)):
        write_lock(db)
        trade = make_trade(db, data)
        db.flush()
        audit(db, "trade_created", f"trade={trade.id}")
        db.commit()
        return serial(record(trade))

    @app.put("/api/trades/{trade_id}")
    def edit_trade(trade_id: int, data: TradeInput, db=Depends(db_session)):
        write_lock(db)
        trade = db.get(Trade, trade_id)
        if not trade:
            raise HTTPException(404, "交易不存在")
        before = serial(record(trade))
        trade = make_trade(db, data, trade)
        audit(db, "trade_edited", json.dumps({"before": before, "after": serial(record(trade))}))
        db.commit()
        return serial(record(trade))

    @app.delete("/api/trades/{trade_id}")
    def delete_trade(trade_id: int, confirm: bool = False, db=Depends(db_session)):
        if not confirm:
            raise DomainError("删除需要明确确认 confirm=true")
        write_lock(db)
        trade = db.get(Trade, trade_id)
        if not trade:
            raise HTTPException(404, "交易不存在")
        if trade.paper_order_id:
            raise DomainError("模拟成交不可删除")
        account, _, _, trades = ledger(db, trade.account_id)
        average_cost([t for t in trades if t.id != trade_id], account.initial_cash)
        before = serial(record(trade))
        db.delete(trade)
        audit(db, "trade_deleted", json.dumps({"before": before}))
        db.commit()
        return {"deleted": trade_id}

    csv_fields = ["account_id", "symbol", "side", "quantity", "price", "fee", "traded_at"]

    @app.get("/api/trades/template.csv")
    def template():
        return Response(
            ",".join(csv_fields) + "\n1,AAPL,buy,10,220,1,2026-10-15T10:00:00-04:00\n",
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=stockpilot-template.csv"},
        )

    @app.post("/api/trades/import")
    def import_csv(data: CSVInput, db=Depends(db_session)):
        write_lock(db)
        reader = csv.DictReader(StringIO(data.content.lstrip("\ufeff")))
        if not reader.fieldnames or set(reader.fieldnames) != set(csv_fields):
            raise DomainError("CSV 表头必须为：" + ",".join(csv_fields))
        errors, duplicates, valid = [], [], []
        seen = set()
        for line, row in enumerate(reader, 2):
            if line > 1001:
                errors.append({"line": line, "error": "单次最多 1000 行"})
                break
            try:
                parsed = TradeInput.model_validate(row)
                fp = fingerprint(parsed)
                if fp in seen or db.scalar(select(Trade.id).where(Trade.fingerprint == fp)):
                    duplicates.append(line)
                    continue
                seen.add(fp)
                valid.append((line, parsed))
            except (ValidationError, ValueError) as exc:
                errors.append({"line": line, "error": str(exc)[:400]})
        # Replay the whole import chronologically, independent of CSV row order.
        for line, parsed in sorted(valid, key=lambda item: item[1].traded_at):
            try:
                make_trade(db, parsed)
                db.flush()
            except DomainError as exc:
                errors.append({"line": line, "error": str(exc)})
        accepted = len(valid) if not errors else 0
        if errors or data.dry_run:
            db.rollback()
        else:
            audit(db, "csv_import", f"accepted={accepted}; duplicates={len(duplicates)}")
            db.commit()
        return {
            "dry_run": data.dry_run,
            "accepted": accepted,
            "duplicates": duplicates,
            "errors": errors,
            "atomic": True,
        }

    @app.get("/api/market-data/status")
    def sources(db=Depends(db_session)):
        return serial(feed_status(db))

    @app.put("/api/market-data/settings")
    def source_settings(data: FeedInput, db=Depends(db_session)):
        if data.akshare_personal_use and not data.akshare_license_reference:
            raise DomainError("启用AKShare前必须记录已核实的上游个人使用授权依据；软件MIT许可不覆盖行情")
        write_lock(db)
        settings = db.get(FeedSettings, 1)
        for key, value in data.model_dump().items():
            setattr(settings, key, value)
        for cached in db.scalars(select(FeedCache)):
            if configuration_error(cached.error) and eligibility(db, cached.provider) is None:
                cached.retry_after = None
                cached.error = None
        audit(db, "feed_settings_updated", f"mode={data.mode}; private-only; no paid subscription")
        db.commit()
        return serial(feed_status(db))

    @app.post("/api/market-data/refresh")
    def refresh_quotes(symbol: str | None = None, db=Depends(db_session)):
        if market_mode(db) != "real":
            raise DomainError("当前为演示行情模式，请先在数据源设置切换到真实行情")
        instruments = list(db.scalars(select(Instrument)))
        if symbol:
            instruments = [i for i in instruments if i.symbol == symbol]
            if not instruments:
                raise DomainError("标的不存在")
        for instrument in instruments:
            refresh_one(db, instrument.symbol, "twelve" if instrument.market == "US" else "akshare")
        refresh_one(db, "USDCNY", "fx")
        audit(db, "market_refresh", "只读免费数据源，执行缓存和调用预算检查；不订阅付费服务")
        db.commit()
        return serial(feed_status(db))

    @app.get("/api/performance")
    def performance(account_id: int = 1, db=Depends(db_session)):
        return serial(equity_history(db, account_id))

    @app.get("/api/market-data")
    def market_data(q: str = "", market: str | None = None, db=Depends(db_session)):
        result = []
        for instrument in db.scalars(select(Instrument)):
            if q.lower() not in (instrument.symbol + instrument.name).lower() or (
                market and market != instrument.market
            ):
                continue
            detail = market_detail(db, instrument.symbol)
            result.append({k: v for k, v in detail.items() if k != "bars"})
        return serial(result)

    @app.get("/api/market-data/{symbol}")
    def stock(symbol: str, db=Depends(db_session)):
        return serial(market_detail(db, symbol))

    @app.get("/api/watchlist")
    def watchlist(db=Depends(db_session)):
        return [w.symbol for w in db.scalars(select(Watchlist))]

    @app.put("/api/watchlist/{symbol}")
    def watch(symbol: str, db=Depends(db_session)):
        write_lock(db)
        if not db.get(Instrument, symbol):
            raise DomainError("股票不存在")
        if not db.get(Watchlist, symbol):
            db.add(Watchlist(symbol=symbol))
            audit(db, "watch_added", symbol)
            db.commit()
        return {"symbol": symbol}

    @app.delete("/api/watchlist/{symbol}")
    def unwatch(symbol: str, db=Depends(db_session)):
        write_lock(db)
        item = db.get(Watchlist, symbol)
        if item:
            db.delete(item)
            audit(db, "watch_removed", symbol)
            db.commit()
        return {"symbol": symbol}

    @app.get("/api/risk-analysis")
    def risks(account_id: int | None = None, db=Depends(db_session)):
        return serial(risk_analysis(db, account_id))

    @app.get("/api/risk-policy")
    def policy(db=Depends(db_session)):
        return serial(record(db.get(RiskPolicy, 1)))

    @app.put("/api/risk-policy")
    def update_policy(data: PolicyInput, db=Depends(db_session)):
        write_lock(db)
        policy = db.get(RiskPolicy, 1)
        for key, value in data.model_dump().items():
            setattr(policy, key, value)
        audit(db, "risk_policy_updated", "用户调整模拟风险阈值")
        db.commit()
        return serial(record(policy))

    @app.get("/api/execution-rules")
    def rules(db=Depends(db_session)):
        return rules_response(db)

    @app.put("/api/execution-rules/{key}")
    def update_rule(key: str, data: RuleInput, db=Depends(db_session)):
        write_lock(db)
        rule = db.get(ExecutionRule, key)
        if not rule:
            raise HTTPException(404, "规则不存在")
        if (key.startswith("CN_") and data.timezone != "Asia/Shanghai") or (
            key == "US_REGULAR" and data.timezone != "America/New_York"
        ):
            raise DomainError("规则时区必须与市场一致")
        rule.payload = data.model_dump_json()
        audit(db, "execution_rule_updated", key)
        db.commit()
        return rules_response(db)

    @app.get("/api/paper-orders")
    def orders(offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), db=Depends(db_session)):
        return serial(
            [
                record(o)
                for o in db.scalars(
                    select(PaperOrder).order_by(PaperOrder.id.desc()).offset(offset).limit(limit)
                )
            ]
        )

    @app.post("/api/paper-orders", status_code=201)
    def order(data: OrderInput, db=Depends(db_session)):
        write_lock(db)
        account_instrument(db, data.account_id, data.symbol, True)
        order = PaperOrder(**data.model_dump())
        db.add(order)
        db.flush()
        audit(db, "paper_order_created", f"order={order.id}; 仅模拟，不发送券商")
        db.commit()
        return serial(record(order))

    @app.post("/api/paper-orders/{order_id}/fill")
    def fill(order_id: int, data: FillInput, db=Depends(db_session)):
        write_lock(db)
        order = db.get(PaperOrder, order_id)
        if not order:
            raise HTTPException(404, "订单不存在")
        fill_paper_order(db, order, data.demo_clock)
        db.commit()
        return serial(record(order))

    @app.post("/api/paper-orders/{order_id}/cancel")
    def cancel(order_id: int, db=Depends(db_session)):
        write_lock(db)
        order = db.get(PaperOrder, order_id)
        if not order or order.status != "pending":
            raise DomainError("只能撤销待成交订单")
        order.status, order.reason = "cancelled", "用户撤销模拟订单"
        audit(db, "paper_order_cancelled", f"order={order_id}")
        db.commit()
        return serial(record(order))

    @app.get("/api/reports")
    def reports(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100), db=Depends(db_session)):
        return serial(
            [
                record(r)
                for r in db.scalars(
                    select(AnalysisReport).order_by(AnalysisReport.id.desc()).offset(offset).limit(limit)
                )
            ]
        )

    @app.post("/api/reports", status_code=201)
    def report(kind: str = Query("daily", pattern="^(daily|weekly|review)$"), db=Depends(db_session)):
        write_lock(db)
        payload = {
            "portfolio": portfolio(db),
            "risk": risk_analysis(db),
            "paper": portfolio(db, paper=True),
            "note": "日报/周报为生成时点快照，非期间绩效。基准与股息税费数据缺失，未计算超额收益。",
        }
        result = AnalysisReport(kind=kind, payload=json.dumps(serial(payload), ensure_ascii=False))
        db.add(result)
        audit(db, "report_created", kind)
        db.commit()
        return serial(record(result))

    @app.get("/api/reports/export.csv")
    def export(db=Depends(db_session)):
        output = StringIO()
        writer = csv.writer(output)
        fields = [
            "account_id",
            "symbol",
            "currency",
            "quantity",
            "average_cost",
            "price",
            "market_value",
            "unrealized",
            "realized",
            "timestamp",
            "source",
        ]
        writer.writerow(fields)
        for p in portfolio(db)["positions"]:
            writer.writerow([p[k] for k in fields])
        return Response(
            "\ufeff" + output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=stockpilot-positions.csv"},
        )

    @app.get("/api/audit-logs")
    def logs(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200), db=Depends(db_session)):
        return serial(
            [
                record(r)
                for r in db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).offset(offset).limit(limit))
            ]
        )

    @app.get("/api/settings")
    def settings(db=Depends(db_session)):
        return {
            "mode": "paper-only",
            "live_trading": False,
            "ai_engine": "rules",
            "source": SOURCE if market_mode(db) == "demo" else "真实行情缓存；报价和汇率均不回退到演示数据",
            "authentication": "local-single-user",
            "limitations": [
                "无实盘下单接口",
                "支持延迟日线；不承诺逐笔实时，未提供付费数据或LLM",
                "仅支持内置6只股票；初始账户含演示持仓",
                "不支持股息、拆股、转账和完整节假日日历",
            ],
        }

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/")
        def index():
            return FileResponse(dist / "index.html")

    return app


app = create_app()
