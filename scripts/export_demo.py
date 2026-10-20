"""Export exclusively a freshly seeded disposable DB, never the user's database."""

import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.engine import correlations, market_detail, portfolio, rules_response
from app.main import record, serial
from app.market import seed
from app.models import (
    Account,
    Base,
    Instrument,
    RiskPolicy,
    Trade,
    FeedSettings,
    make_engine,
    sessions,
)
from sqlalchemy import select

root = Path(__file__).resolve().parents[1]
with TemporaryDirectory(prefix="stockpilot-release-") as directory:
    engine = make_engine(str(Path(directory) / "seed.db"))
    Base.metadata.create_all(engine)
    with sessions(engine)() as db:
        seed(db)
        db.add(FeedSettings(id=1, mode="demo"))
        db.commit()
        symbols = list(db.scalars(select(Instrument.symbol)))
        payload = {
            "accounts": [record(a) for a in db.scalars(select(Account))],
            "trades": [record(t) for t in db.scalars(select(Trade))],
            "stocks": [market_detail(db, s) for s in symbols],
            "policy": record(db.get(RiskPolicy, 1)),
            "rules": rules_response(db),
            "watchlist": symbols,
            "fx": portfolio(db)["fx"],
            "correlations": correlations(db, symbols),
        }
    engine.dispose()
(root / "frontend/src/demo-seed.json").write_text(
    json.dumps(serial(payload), ensure_ascii=False), encoding="utf-8"
)
print("Exported fresh synthetic seed only; no user database was read.")
