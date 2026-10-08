import pytest
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from apps.core.tasks import ping
from config.asgi import application


@pytest.mark.django_db
def test_health_endpoint(api_client):
    response = api_client.get("/api/health/")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["timezone"] == "Africa/Abidjan"
    assert body["currency"] == "XOF"


@pytest.mark.django_db
def test_openapi_schema_is_generated(api_client):
    response = api_client.get("/api/schema/")
    assert response.status_code == 200
    assert b"/api/auth/login/" in response.content


def test_celery_ping_runs_eagerly():
    assert ping.delay().get()


@pytest.mark.django_db(transaction=True)
async def test_websocket_rejects_anonymous():
    communicator = WebsocketCommunicator(application, "/ws/status/", headers=[(b"origin", b"http://localhost")])
    connected, code = await communicator.connect()
    assert not connected
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
async def test_websocket_accepts_valid_jwt_and_answers_ping(cashier_user_async):
    token = str(AccessToken.for_user(cashier_user_async))
    communicator = WebsocketCommunicator(
        application, f"/ws/status/?token={token}", headers=[(b"origin", b"http://localhost")]
    )
    connected, _ = await communicator.connect()
    assert connected
    welcome = await communicator.receive_json_from()
    assert welcome["type"] == "welcome"
    await communicator.send_json_to({"type": "ping"})
    pong = await communicator.receive_json_from()
    assert pong["type"] == "pong"
    await communicator.disconnect()


@pytest.fixture
def cashier_user_async(transactional_db):
    # Une base transactionnelle est vidée entre les tests : les rôles issus de la migration
    # de données doivent être recréés.
    from apps.accounts.catalog import sync_permissions_and_roles
    from apps.accounts.models import Permission, Role
    from conftest import make_user

    sync_permissions_and_roles(Permission, Role)
    return make_user("caisse-ws", "CAISSIER")
