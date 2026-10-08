import uuid

import pytest
from channels.testing import WebsocketCommunicator
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.catalog import INVENTORISTE, MAGASINIER, PREPARATEUR
from apps.catalog.tests.factories import make_article
from apps.notifications.models import Notification, NotificationPreference, PushSubscription
from apps.notifications.services import deliver, notify
from apps.stock.models import Depot, StockMovement
from apps.stock.services import record_movement, refresh_alerts
from conftest import make_user

pytestmark = pytest.mark.django_db


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def cahier(mag):
    article = make_article("Cahier 100 pages", 400, 250, is_online=True, alert_threshold=5)
    record_movement(article, mag, StockMovement.Kind.PURCHASE, 30)
    return article


def place_order(client_user, cahier, qty=2):
    response = client_for(client_user).post("/api/shop/orders/", {"lines": [{"article": str(cahier.pk), "quantity": qty}]},
                                            format="json")
    assert response.status_code == 201, response.content
    return response.json()


def test_new_order_notifies_staff_who_can_confirm(client_user, manager_user, cahier,
                                                  django_capture_on_commit_callbacks):
    preparer = make_user("prep", PREPARATEUR)
    with django_capture_on_commit_callbacks(execute=True):
        order = place_order(client_user, cahier)
    notification = Notification.objects.get(recipient=manager_user, event="order_placed")
    assert order["number"] in notification.title and notification.url == f"/commandes/detail/{order['id']}"
    assert notification.deliveries["in_app"] == "ok"
    assert notification.deliveries["push"].startswith("skipped")  # pas de clés VAPID en test
    assert not Notification.objects.filter(recipient=preparer).exists()
    assert not Notification.objects.filter(recipient=client_user).exists()


def test_order_ready_reaches_customer_on_all_default_channels(client_user, manager_user, cahier,
                                                              django_capture_on_commit_callbacks, caplog):
    order = place_order(client_user, cahier)
    staff = client_for(manager_user)
    with django_capture_on_commit_callbacks(execute=True):
        staff.post(f"/api/orders/orders/{order['id']}/confirm/")
        detail = staff.get(f"/api/orders/orders/{order['id']}/").json()
        lines = [{"line": line["id"], "prepared_qty": line["quantity"]} for line in detail["lines"]]
        caplog.set_level("INFO", logger="librairie.notifications")
        staff.post(f"/api/orders/orders/{order['id']}/prepare/", {"lines": lines, "ready": True}, format="json")
    events = list(Notification.objects.filter(recipient=client_user).values_list("event", flat=True))
    assert {"order_confirmed", "order_preparing", "order_ready"} <= set(events)
    ready = Notification.objects.get(recipient=client_user, event="order_ready")
    assert detail["pickup_code"] in ready.body and ready.url == f"/mes-commandes/{order['id']}"
    assert ready.deliveries["sms"] == "ok (console)" and ready.deliveries["email"].startswith("skipped")
    assert any("SMS console" in record.message for record in caplog.records)


def test_preferences_filter_channels_and_events(client_user, manager_user, cahier):
    client = client_for(client_user)
    rows = client.get("/api/notifications/preferences/").json()
    assert {row["event"] for row in rows} >= {"order_ready", "order_confirmed"}
    assert "order_placed" not in {row["event"] for row in rows}  # événement réservé au personnel
    ready = next(row for row in rows if row["event"] == "order_ready")
    assert ready["sms"] is True
    updated = client.put("/api/notifications/preferences/", [dict(ready, in_app=False, push=False, sms=False,
                                                                       email=False)], format="json").json()
    assert next(r for r in updated if r["event"] == "order_ready")["in_app"] is False
    assert notify("order_ready", [client_user], title="x") == []  # tout désactivé : rien n'est créé
    NotificationPreference.objects.filter(user=client_user, event="order_ready").update(email=True)
    created = notify("order_ready", [client_user], title="x")
    assert created[0].read_at is not None  # hors cloche : marquée lue d'office


def test_unread_count_read_and_read_all(manager_user):
    notify("order_placed", [manager_user], title="A")
    second = notify("order_placed", [manager_user], title="B")[0]
    client = client_for(manager_user)
    assert client.get("/api/notifications/unread/").json()["unread"] == 2
    assert client.post(f"/api/notifications/{second.pk}/read/").json()["read_at"]
    assert client.get("/api/notifications/unread/").json()["unread"] == 1
    assert len(client.get("/api/notifications/?unread=1").json()["results"]) == 1
    client.post("/api/notifications/read-all/")
    assert client.get("/api/notifications/unread/").json()["unread"] == 0
    other = make_user("autre", MAGASINIER)
    assert client_for(other).get("/api/notifications/").json()["count"] == 0


def test_stock_alert_cash_variance_sync_error_and_inventory(manager_user, admin_user, cashier_user, mag, cahier,
                                                            django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        record_movement(cahier, mag, StockMovement.Kind.SALE, -27)
        refresh_alerts([cahier])
    assert Notification.objects.filter(recipient=manager_user, event="stock_low").exists()

    from apps.accounts.models import Device

    Device.objects.create(code="C01", name="Caisse 1")
    client = client_for(cashier_user)
    session = str(uuid.uuid4())

    def push(entity, operation, payload):
        return client.post("/api/sync/push/", {"operations": [{"id": str(uuid.uuid4()), "entity": entity,
                                                               "operation": operation, "payload": payload,
                                                               "client_timestamp": "2026-10-08T10:00:00Z"}]},
                           format="json", HTTP_X_DEVICE_CODE="C01").json()["results"][0]

    with django_capture_on_commit_callbacks(execute=True):
        push("cash_session", "open", {"id": session, "depot": str(mag.pk), "opening_float": 10000})
        push("cash_session", "close", {"session": session, "counted_cash": 9500, "z_number": "Z-1"})
        assert push("sale", "create", {"id": str(uuid.uuid4()), "receipt_number": "BAD"})["status"] == "error"
    variance = Notification.objects.get(recipient=manager_user, event="cash_variance")
    assert "manque de 500 FCFA" in variance.title
    assert Notification.objects.filter(recipient=admin_user, event="sync_error").exists()

    inventoriste = make_user("inv", INVENTORISTE)
    manager = client_for(manager_user)
    created = manager.post("/api/inventory/sessions/", {"name": "Test", "kind": "FULL", "depot": str(mag.pk)},
                           format="json").json()
    manager.post(f"/api/inventory/sessions/{created['id']}/start/")
    with django_capture_on_commit_callbacks(execute=True):
        manager.post(f"/api/inventory/sessions/{created['id']}/review/")
    assert Notification.objects.filter(recipient=admin_user, event="inventory_review").exists()
    assert not Notification.objects.filter(recipient=manager_user, event="inventory_review").exists()  # auteur
    assert not Notification.objects.filter(recipient=inventoriste, event="inventory_review").exists()


def test_authorization_request_notifies_managers(cashier_user, manager_user, admin_user):
    response = client_for(cashier_user).post("/api/notifications/authorization-request/",
                                             {"reason": "Remise de 15 % sur un kit"}, format="json")
    assert response.status_code == 200 and response.json()["notified"] == 2
    notification = Notification.objects.get(recipient=manager_user, event="authorization_request")
    assert "Aya Traoré" in notification.title and notification.body == "Remise de 15 % sur un kit"


def test_web_push_subscription_and_delivery(manager_user, settings, monkeypatch):
    settings.VAPID_PUBLIC_KEY = "public-test"
    settings.VAPID_PRIVATE_KEY = "private-test"
    client = client_for(manager_user)
    assert client.get("/api/notifications/push/").json()["public_key"] == "public-test"
    for endpoint in ("https://push.example/ok", "https://push.example/gone"):
        assert client.post("/api/notifications/push/", {"endpoint": endpoint, "keys": {"p256dh": "k", "auth": "a"},
                                                        "app": "backoffice"}, format="json").status_code == 201
    sent = []

    class Gone(Exception):
        pass

    import pywebpush

    def fake_webpush(subscription_info, data, **kwargs):
        if subscription_info["endpoint"].endswith("gone"):
            raise pywebpush.WebPushException("expiré", response=type("R", (), {"status_code": 410})())
        sent.append(data)

    monkeypatch.setattr(pywebpush, "webpush", fake_webpush)
    notification = notify("order_placed", [manager_user], title="Nouvelle commande", url="/commandes/a-confirmer")[0]
    results = deliver(notification.pk, ["push"])
    assert results["push"] == "ok (1/2)" and '"navigateLastFocusedOrOpen"' in sent[0]
    assert list(PushSubscription.objects.values_list("endpoint", flat=True)) == ["https://push.example/ok"]
    client.delete("/api/notifications/push/", {"endpoint": "https://push.example/ok"}, format="json")
    assert not PushSubscription.objects.exists()


@pytest.fixture
def manager_async(transactional_db):
    # Base transactionnelle vidée entre les tests : rôles et permissions à recréer.
    from apps.accounts.catalog import GERANT, sync_permissions_and_roles
    from apps.accounts.models import Permission, Role

    sync_permissions_and_roles(Permission, Role)
    return make_user("gerant-ws", GERANT)


@pytest.mark.django_db(transaction=True)
async def test_websocket_receives_notification_in_real_time(manager_async):
    manager_user = manager_async
    from asgiref.sync import sync_to_async

    from config.asgi import application

    token = await sync_to_async(lambda: str(AccessToken.for_user(manager_user)))()
    communicator = WebsocketCommunicator(application, f"/ws/status/?token={token}",
                                         headers=[(b"origin", b"http://localhost")])
    connected, _ = await communicator.connect()
    assert connected
    assert (await communicator.receive_json_from())["type"] == "welcome"
    notification = (await sync_to_async(notify)("order_placed", [manager_user], title="Temps réel"))[0]
    await sync_to_async(deliver)(notification.pk, ["in_app"])
    message = await communicator.receive_json_from(timeout=2)
    assert message["type"] == "notification" and message["notification"]["title"] == "Temps réel"
    assert message["unread"] == 1
    await communicator.disconnect()
