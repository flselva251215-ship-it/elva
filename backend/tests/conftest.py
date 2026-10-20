from fastapi.testclient import TestClient
import pytest

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(str(tmp_path / "test.db"), data_mode="demo")
    with TestClient(app) as client:
        yield client


@pytest.fixture
def db(client):
    with client.app.state.session_factory() as session:
        yield session
