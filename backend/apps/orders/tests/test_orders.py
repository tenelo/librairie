import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.catalog import PREPARATEUR
from apps.accounts.models import Device
from apps.catalog.tests.factories import make_article, make_kit
from apps.orders import services
from apps.orders.models import OnlineOrder
from apps.sales.models import Sale
from apps.settings_app.models import LibrarySettings
from apps.stock.models import Depot, StockLevel, StockMovement
from apps.stock.services import available, on_hand, record_movement
from conftest import make_user

pytestmark = pytest.mark.django_db
TS = "2026-10-08T10:00:00Z"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def till(db):
    return Device.objects.create(code="C01", name="Caisse 1")


@pytest.fixture
def preparer(db):
    return make_user("prep", PREPARATEUR, first_name="Ali", last_name="Bamba")


@pytest.fixture
def stock(mag):
    cahier = make_article("Cahier 100 pages", 400, 250, is_online=True)
    stylo = make_article("Stylo bleu", 150, 80, is_online=True)
    gomme = make_article("Gomme", 100, 40, is_online=True)
    for article, qty in ((cahier, 40), (stylo, 30), (gomme, 10)):
        record_movement(article, mag, StockMovement.Kind.PURCHASE, qty)
    return cahier, stylo, gomme


def place(client, lines, **extra):
    response = client.post("/api/shop/orders/", {"lines": [{"article": str(a.pk), "quantity": q} for a, q in lines],
                                                 **extra}, format="json")
    return response


def push(client, ops, device="C01"):
    response = client.post("/api/sync/push/", {"operations": [
        {"id": str(uuid.uuid4()), "entity": e, "operation": o, "payload": p, "client_timestamp": TS}
        for e, o, p in ops]}, format="json", HTTP_X_DEVICE_CODE=device)
    assert response.status_code == 200, response.content
    return response.json()["results"]


def prepare_all(client, order_id, ready=True):
    order = client.get(f"/api/orders/orders/{order_id}/").json()
    lines = [{"line": line["id"], "prepared_qty": line["quantity"]} for line in order["lines"]]
    return client.post(f"/api/orders/orders/{order_id}/prepare/", {"lines": lines, "ready": ready}, format="json")


def test_full_cycle_kit_order_reservation_and_pickup_sale(client_user, manager_user, preparer, cashier_user, mag,
                                                          till, stock):
    cahier, stylo, _ = stock
    kit = make_kit([(cahier, 4), (stylo, 2)], discount=Decimal("10"))  # (1600 + 300) x 0,9 = 1710
    kit.article.is_online = True
    kit.article.save()
    shop = client_for(client_user)
    kits = shop.get(f"/api/shop/kits/?level={kit.level_id}").json()["results"]
    assert kits[0]["article"]["price"] == 1710 and kits[0]["article"]["availability"] == "IN_STOCK"

    response = place(shop, [(kit.article, 1), (cahier, 2)], comment="Pour la rentrée")
    assert response.status_code == 201, response.content
    order = response.json()
    assert order["status"] == "RECEIVED" and order["total"] == 1710 + 800 and len(order["pickup_code"]) == 6
    assert order["number"].startswith("CMD-")

    staff = client_for(manager_user)
    assert staff.post(f"/api/orders/orders/{order['id']}/confirm/").status_code == 200
    # Réservation : 4 + 2 cahiers, 2 stylos ; le stock physique est inchangé.
    assert on_hand(cahier, mag) == 40 and available(cahier, mag) == 34 and available(stylo, mag) == 28
    # Confirmer deux fois ne réserve pas deux fois.
    assert staff.post(f"/api/orders/orders/{order['id']}/confirm/").status_code == 400
    services.sync_reservation(OnlineOrder.objects.get(pk=order["id"]))
    assert available(cahier, mag) == 34
    history = shop.get(f"/api/shop/orders/{order['id']}/").json()["history"]
    assert [h["to_status"] for h in history] == ["RECEIVED", "CONFIRMED"]


def test_preparation_ready_pickup_by_qr_creates_sale(client_user, manager_user, preparer, cashier_user, mag, till,
                                                     stock):
    cahier, stylo, _ = stock
    shop = client_for(client_user)
    order = place(shop, [(cahier, 3), (stylo, 2)]).json()
    staff = client_for(manager_user)
    staff.post(f"/api/orders/orders/{order['id']}/confirm/")
    prep = client_for(preparer)
    assert prep.post(f"/api/orders/orders/{order['id']}/start/").json()["status"] == "PREPARING"
    picking = prep.get(f"/api/orders/orders/{order['id']}/picking/").json()
    assert {line["name"] for line in picking["lines"]} == {"Cahier 100 pages", "Stylo bleu"}

    # Préparation incomplète refusée, puis complète.
    lines = [{"line": line["line"], "prepared_qty": 1} for line in picking["lines"]]
    incomplete = prep.post(f"/api/orders/orders/{order['id']}/prepare/", {"lines": lines, "ready": True},
                           format="json")
    assert incomplete.status_code == 400
    ready = prepare_all(prep, order["id"])
    assert ready.status_code == 200 and ready.json()["status"] == "READY" and ready.json()["expires_at"]

    # Retrait : le QR code retrouve la commande, la vente la clôture.
    cashier = client_for(cashier_user)
    found = cashier.get("/api/orders/orders/lookup/", {"code": ready.json()["qr_payload"]})
    assert found.status_code == 200 and found.json()["id"] == order["id"]
    session_id = str(uuid.uuid4())
    push(cashier, [("cash_session", "open", {"id": session_id, "depot": str(mag.pk), "opening_float": 0})])
    total = order["total"]
    sale = {"id": str(uuid.uuid4()), "receipt_number": "C01-20261008-0001", "depot": str(mag.pk),
            "cash_session": session_id, "online_order": order["id"],
            "lines": [{"article": line["article"], "quantity": line["quantity"], "unit_price": line["unit_price"],
                       "line_total": line["line_total"]} for line in ready.json()["lines"]],
            "subtotal": total, "global_discount": 0, "total": total,
            "payments": [{"method": "CASH", "amount": total}], "change_due": 0}
    partial = dict(sale, id=str(uuid.uuid4()), receipt_number="C01-20261008-0009", lines=sale["lines"][:1],
                   subtotal=sale["lines"][0]["line_total"], total=sale["lines"][0]["line_total"],
                   payments=[{"method": "CASH", "amount": sale["lines"][0]["line_total"]}])
    assert push(cashier, [("sale", "create", partial)])[0]["status"] == "error"  # lignes ≠ commande
    result = push(cashier, [("sale", "create", sale)])
    assert result[0]["status"] == "ok", result
    order_obj = OnlineOrder.objects.get(pk=order["id"])
    assert order_obj.status == "PICKED_UP" and order_obj.sale.channel == Sale.Channel.ONLINE
    assert order_obj.sale.customer == order_obj.customer
    assert on_hand(cahier, mag) == 37 and available(cahier, mag) == 37  # réservation libérée
    assert StockLevel.objects.get(article=stylo, depot=mag).reserved == 0
    # Une seconde vente sur la même commande est refusée.
    again = dict(sale, id=str(uuid.uuid4()), receipt_number="C01-20261008-0002")
    assert push(cashier, [("sale", "create", again)])[0]["status"] == "error"


def test_customer_cancel_only_before_preparation_and_stock_released(client_user, manager_user, preparer, mag, stock):
    cahier, _, _ = stock
    shop = client_for(client_user)
    first = place(shop, [(cahier, 5)]).json()
    client_for(manager_user).post(f"/api/orders/orders/{first['id']}/confirm/")
    assert available(cahier, mag) == 35
    cancelled = shop.post(f"/api/shop/orders/{first['id']}/cancel/")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    assert available(cahier, mag) == 40

    second = place(shop, [(cahier, 2)]).json()
    client_for(manager_user).post(f"/api/orders/orders/{second['id']}/confirm/")
    client_for(preparer).post(f"/api/orders/orders/{second['id']}/start/")
    assert shop.post(f"/api/shop/orders/{second['id']}/cancel/").status_code == 400
    # Annulation par la librairie : motif obligatoire.
    staff = client_for(manager_user)
    assert staff.post(f"/api/orders/orders/{second['id']}/cancel/", {}, format="json").status_code == 400
    assert staff.post(f"/api/orders/orders/{second['id']}/cancel/", {"reason": "Client injoignable"},
                      format="json").json()["status"] == "CANCELLED"
    assert available(cahier, mag) == 40


def test_order_rejected_when_stock_insufficient_and_confirm_is_strict(client_user, manager_user, mag, stock):
    _, _, gomme = stock
    shop = client_for(client_user)
    assert place(shop, [(gomme, 11)]).status_code == 400
    first = place(shop, [(gomme, 8)]).json()
    second = place(shop, [(gomme, 8)]).json()  # accepté : rien n'est encore réservé
    staff = client_for(manager_user)
    assert staff.post(f"/api/orders/orders/{first['id']}/confirm/").status_code == 200
    refused = staff.post(f"/api/orders/orders/{second['id']}/confirm/")
    assert refused.status_code == 400 and "Réservation impossible" in str(refused.content.decode())
    assert OnlineOrder.objects.get(pk=second["id"]).status == "RECEIVED"


def test_shortage_auto_applied_when_partial_accepted(client_user, manager_user, preparer, mag, stock):
    cahier, stylo, _ = stock
    shop = client_for(client_user)
    order = place(shop, [(cahier, 4), (stylo, 3)], accept_partial=True).json()
    client_for(manager_user).post(f"/api/orders/orders/{order['id']}/confirm/")
    prep = client_for(preparer)
    lines = {line["description"]: line["id"] for line in order["lines"]}
    response = prep.post(f"/api/orders/orders/{order['id']}/prepare/", {
        "lines": [{"line": lines["Cahier 100 pages"], "prepared_qty": 4}, {"line": lines["Stylo bleu"],
                                                                           "prepared_qty": 1}],
        "shortages": [{"line": lines["Stylo bleu"], "quantity": 1}], "ready": True}, format="json")
    assert response.status_code == 200, response.content
    data = response.json()
    assert data["status"] == "READY" and data["total"] == 4 * 400 + 150
    assert available(stylo, mag) == 29  # 1 stylo réservé au lieu de 3


def test_substitution_requires_customer_approval(client_user, manager_user, preparer, mag, stock):
    cahier, stylo, _ = stock
    stylo_rouge = make_article("Stylo rouge", 175, 80, is_online=True)
    record_movement(stylo_rouge, mag, StockMovement.Kind.PURCHASE, 5)
    shop = client_for(client_user)
    order = place(shop, [(stylo, 2)]).json()
    client_for(manager_user).post(f"/api/orders/orders/{order['id']}/confirm/")
    line_id = order["lines"][0]["id"]
    prep = client_for(preparer)
    response = prep.post(f"/api/orders/orders/{order['id']}/prepare/", {
        "lines": [{"line": line_id, "prepared_qty": 0}],
        "shortages": [{"line": line_id, "quantity": 0, "substitute": str(stylo_rouge.pk)}], "ready": True},
        format="json")
    assert response.json()["status"] == "PREPARING" and response.json()["awaiting_customer"] is True
    proposal = shop.get(f"/api/shop/orders/{order['id']}/").json()["lines"][0]["proposal"]
    assert proposal["substitute_name"] == "Stylo rouge" and proposal["unit_price"] == 175

    accepted = shop.post(f"/api/shop/orders/{order['id']}/answer/", {"accept": True}, format="json").json()
    assert accepted["status"] == "PREPARING" and accepted["total"] == 350
    assert available(stylo, mag) == 30 and available(stylo_rouge, mag) == 3
    ready = prepare_all(prep, order["id"])
    assert ready.json()["status"] == "READY"


def test_refused_modification_cancels_order(client_user, manager_user, preparer, mag, stock):
    cahier, _, _ = stock
    shop = client_for(client_user)
    order = place(shop, [(cahier, 2)]).json()
    client_for(manager_user).post(f"/api/orders/orders/{order['id']}/confirm/")
    client_for(preparer).post(f"/api/orders/orders/{order['id']}/prepare/", {
        "shortages": [{"line": order["lines"][0]["id"], "quantity": 1}], "ready": True}, format="json")
    refused = shop.post(f"/api/shop/orders/{order['id']}/answer/", {"accept": False}, format="json").json()
    assert refused["status"] == "CANCELLED" and available(cahier, mag) == 40


def test_expiry_releases_reservation_and_reminder(client_user, manager_user, preparer, mag, stock):
    cahier, _, _ = stock
    shop = client_for(client_user)
    order = place(shop, [(cahier, 3)]).json()
    client_for(manager_user).post(f"/api/orders/orders/{order['id']}/confirm/")
    prepare_all(client_for(preparer), order["id"])
    obj = OnlineOrder.objects.get(pk=order["id"])
    assert obj.expires_at - obj.ready_at == timedelta(hours=LibrarySettings.load().order_expiry_hours)
    received = []
    services.order_event.connect(lambda **kw: received.append(kw["event"]), weak=False, dispatch_uid="t-remind")
    try:
        assert services.remind_due(obj.expires_at - timedelta(hours=2)) == 1
        assert services.remind_due(obj.expires_at - timedelta(hours=1)) == 0  # un seul rappel
        assert services.expire_due(obj.expires_at - timedelta(minutes=1)) == 0
        assert services.expire_due(obj.expires_at + timedelta(minutes=1)) == 1
    finally:
        services.order_event.disconnect(dispatch_uid="t-remind")
    assert "reminder" in received
    obj.refresh_from_db()
    assert obj.status == "EXPIRED" and available(cahier, mag) == 40


def test_sandbox_deposit_and_imputation_at_pickup(client_user, manager_user, preparer, cashier_user, mag, till,
                                                  stock):
    cahier, _, _ = stock
    settings = LibrarySettings.load()
    settings.online_deposit_percent = 30
    settings.save()
    shop = client_for(client_user)
    assert shop.get("/api/shop/reference/").json()["sandbox_payments"] is True
    order = place(shop, [(cahier, 5)], payment_mode="DEPOSIT").json()
    assert order["deposit_due"] == 600
    bad = shop.post(f"/api/shop/orders/{order['id']}/deposit/", {"phone": "07", "operator": "WAVE"}, format="json")
    assert bad.status_code == 400
    started = shop.post(f"/api/shop/orders/{order['id']}/deposit/", {"phone": "0708091011", "operator": "WAVE"},
                        format="json").json()
    assert started["reference"].startswith("SBX-") and started["status"] == "PENDING"
    assert OnlineOrder.objects.get(pk=order["id"]).deposit_paid == 0
    shop.post(f"/api/shop/payments/{started['reference']}/simulate/", {"success": True}, format="json")
    shop.post(f"/api/shop/payments/{started['reference']}/simulate/", {"success": True}, format="json")  # idempotent
    assert OnlineOrder.objects.get(pk=order["id"]).deposit_paid == 600

    client_for(manager_user).post(f"/api/orders/orders/{order['id']}/confirm/")
    prepare_all(client_for(preparer), order["id"])
    cashier = client_for(cashier_user)
    session_id = str(uuid.uuid4())
    push(cashier, [("cash_session", "open", {"id": session_id, "depot": str(mag.pk), "opening_float": 0})])

    def sale(deposit, number):
        return {"id": str(uuid.uuid4()), "receipt_number": number, "depot": str(mag.pk), "cash_session": session_id,
                "online_order": order["id"],
                "lines": [{"article": str(cahier.pk), "quantity": 5, "unit_price": 400, "line_total": 2000}],
                "subtotal": 2000, "global_discount": 0, "total": 2000,
                "payments": [{"method": "ONLINE_DEPOSIT", "amount": deposit}, {"method": "CASH", "amount": 2000 - deposit}],
                "change_due": 0}

    assert push(cashier, [("sale", "create", sale(700, "C01-20261008-0001"))])[0]["status"] == "error"
    assert push(cashier, [("sale", "create", sale(600, "C01-20261008-0002"))])[0]["status"] == "ok"
    assert OnlineOrder.objects.get(pk=order["id"]).status == "PICKED_UP"


def test_offline_preparation_push_and_pull(client_user, manager_user, preparer, mag, till, stock):
    cahier, _, _ = stock
    shop = client_for(client_user)
    order = place(shop, [(cahier, 2)]).json()
    client_for(manager_user).post(f"/api/orders/orders/{order['id']}/confirm/")
    prep = client_for(preparer)
    rows = prep.get("/api/sync/pull/?entities=online_orders").json()["changes"]["online_orders"]
    mirrored = next(row for row in rows if row["id"] == order["id"])
    assert mirrored["is_deleted"] is False and mirrored["lines"][0]["quantity"] == 2
    result = push(prep, [("online_order", "prepare", {
        "order": order["id"], "lines": [{"line": mirrored["lines"][0]["id"], "prepared_qty": 2}], "ready": True,
        "parcels": 1})])
    assert result[0]["status"] == "ok" and result[0]["result"]["status"] == "READY"


def test_shop_catalog_is_public_and_hides_offline_articles(api_client, stock):
    cahier, _, gomme = stock
    make_article("Article interne", 100)  # non publié en ligne
    data = api_client.get("/api/shop/articles/?search=a").json()
    names = {row["name"] for row in data["results"]}
    assert "Article interne" not in names and "Cahier 100 pages" in names
    detail = api_client.get(f"/api/shop/articles/{gomme.pk}/").json()
    assert detail["availability"] in ("IN_STOCK", "LOW") and detail["available"] == 10
    reference = api_client.get("/api/shop/reference/").json()
    assert reference["pickup_points"] and {"code": "WAVE", "label": "Wave"} in reference["operators"]


def test_staff_permissions(client_user, cashier_user, preparer, stock):
    cahier, _, _ = stock
    order = place(client_for(client_user), [(cahier, 1)]).json()
    assert client_for(preparer).post(f"/api/orders/orders/{order['id']}/confirm/").status_code == 403
    assert client_for(cashier_user).get("/api/orders/orders/?group=to_confirm").status_code == 200
    assert client_for(client_user).get("/api/orders/orders/").status_code == 403
    assert timezone.now()
