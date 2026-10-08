import datetime
import uuid

import pytest
from django.utils import timezone

from apps.catalog.models import Article
from apps.catalog.tests.factories import make_article
from apps.purchasing.models import GoodsReceipt, PurchaseOrder, Supplier, SupplierArticle
from apps.purchasing.services import receive_goods, reorder_suggestions
from apps.purchasing.views import order_document_context
from apps.core.pdf import render_html
from apps.stock.models import Depot, StockAlert, StockMovement
from apps.stock.services import on_hand, record_movement
from conftest import make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def supplier():
    return Supplier.objects.create(name="SOCIPAP", phone="27 21 00 00 00", lead_time_days=10)


@pytest.fixture
def storekeeper(db):
    return make_user("magasinier", "MAGASINIER")


def create_order(client, supplier, mag, lines):
    response = client.post("/api/purchasing/orders/", {
        "supplier": str(supplier.pk), "depot": str(mag.pk), "order_date": "2026-10-01",
        "expected_date": "2026-10-11", "lines": lines}, format="json")
    assert response.status_code == 201, response.content
    return response.json()


def test_order_lifecycle_with_partial_then_full_receipt(auth_client, manager_user, storekeeper, supplier, mag):
    cahier = make_article("Cahier", cost=0, alert_threshold=10)
    stylo = make_article("Stylo", cost=0)
    manager = auth_client(manager_user)
    order = create_order(manager, supplier, mag, [
        {"article": str(cahier.pk), "quantity": 100, "unit_cost": 250},
        {"article": str(stylo.pk), "quantity": 50, "unit_cost": 80},
    ])
    assert order["number"].startswith("BC-") and order["total"] == 100 * 250 + 50 * 80
    assert manager.post(f"/api/purchasing/orders/{order['id']}/send/").json()["status"] == "SENT"
    assert manager.patch(f"/api/purchasing/orders/{order['id']}/", {"note": "x"}, format="json").status_code == 400

    lines = {line["article"]: line for line in order["lines"]}
    keeper = auth_client(storekeeper)
    first = keeper.post("/api/purchasing/receipts/", {
        "supplier": str(supplier.pk), "depot": str(mag.pk), "purchase_order": order["id"], "delivery_note": "BL-77",
        "lines": [{"article": str(cahier.pk), "order_line": lines[str(cahier.pk)]["id"], "quantity": 60,
                   "unit_cost": 250}],
    }, format="json")
    assert first.status_code == 201, first.content
    assert first.json()["number"].startswith("REC-")
    assert PurchaseOrder.objects.get(pk=order["id"]).status == PurchaseOrder.Status.PARTIAL
    assert on_hand(cahier, mag) == 60

    keeper.post("/api/purchasing/receipts/", {
        "supplier": str(supplier.pk), "depot": str(mag.pk), "purchase_order": order["id"],
        "lines": [
            {"article": str(cahier.pk), "order_line": lines[str(cahier.pk)]["id"], "quantity": 40, "unit_cost": 280},
            {"article": str(stylo.pk), "order_line": lines[str(stylo.pk)]["id"], "quantity": 50, "unit_cost": 80},
        ],
    }, format="json")
    detail = manager.get(f"/api/purchasing/orders/{order['id']}/").json()
    assert detail["status"] == "RECEIVED"
    assert all(line["remaining"] == 0 for line in detail["lines"])
    cahier.refresh_from_db()
    assert cahier.avg_cost == 262  # (60 × 250 + 40 × 280) / 100
    assert SupplierArticle.objects.get(supplier=supplier, article=cahier).last_cost == 280
    assert not StockAlert.objects.filter(article=cahier, resolved_at__isnull=True).exists()


def test_receipt_without_order_and_idempotent_offline_replay(auth_client, storekeeper, supplier, mag):
    cahier = make_article("Cahier", cost=0)
    receipt_id = str(uuid.uuid4())
    payload = {"id": receipt_id, "supplier": str(supplier.pk), "depot": str(mag.pk),
               "lines": [{"article": str(cahier.pk), "quantity": 24, "unit_cost": 240}]}
    client = auth_client(storekeeper)
    assert client.post("/api/purchasing/receipts/", payload, format="json").status_code == 201
    assert client.post("/api/purchasing/receipts/", payload, format="json").status_code == 201
    assert GoodsReceipt.objects.count() == 1 and on_hand(cahier, mag) == 24


def test_receipt_of_lots_updates_base_article_cost(supplier, mag):
    stylo = make_article("Stylo", cost=0)
    paquet = make_article("Paquet de 10", type_=Article.Type.LOT, lot_base_article=stylo, lot_units=10)
    receive_goods(supplier=supplier, depot=mag, lines=[{"article": paquet, "quantity": 5, "unit_cost": 700}])
    stylo.refresh_from_db()
    assert on_hand(stylo, mag) == 50 and stylo.avg_cost == 70


def test_receipt_rules(auth_client, manager_user, storekeeper, supplier, mag):
    cahier = make_article("Cahier")
    other = Supplier.objects.create(name="Autre")
    order = create_order(auth_client(manager_user), supplier, mag,
                         [{"article": str(cahier.pk), "quantity": 10, "unit_cost": 200}])
    keeper = auth_client(storekeeper)
    draft = keeper.post("/api/purchasing/receipts/", {
        "supplier": str(supplier.pk), "depot": str(mag.pk), "purchase_order": order["id"],
        "lines": [{"article": str(cahier.pk), "quantity": 1, "unit_cost": 200}]}, format="json")
    assert draft.status_code == 400  # bon encore en brouillon
    auth_client(manager_user).post(f"/api/purchasing/orders/{order['id']}/send/")
    wrong_supplier = keeper.post("/api/purchasing/receipts/", {
        "supplier": str(other.pk), "depot": str(mag.pk), "purchase_order": order["id"],
        "lines": [{"article": str(cahier.pk), "quantity": 1, "unit_cost": 200}]}, format="json")
    assert wrong_supplier.status_code == 400
    service = make_article("Photocopie", type_=Article.Type.SERVICE)
    not_stocked = keeper.post("/api/purchasing/receipts/", {
        "supplier": str(supplier.pk), "depot": str(mag.pk),
        "lines": [{"article": str(service.pk), "quantity": 1, "unit_cost": 10}]}, format="json")
    assert not_stocked.status_code == 400
    assert not StockMovement.objects.exists()


def test_cancel_and_close_rules(auth_client, manager_user, supplier, mag):
    cahier = make_article("Cahier")
    client = auth_client(manager_user)
    order = create_order(client, supplier, mag, [{"article": str(cahier.pk), "quantity": 10, "unit_cost": 200}])
    assert client.post(f"/api/purchasing/orders/{order['id']}/close/").status_code == 400
    assert client.post(f"/api/purchasing/orders/{order['id']}/cancel/").json()["status"] == "CANCELLED"
    assert client.post(f"/api/purchasing/orders/{order['id']}/send/").status_code == 400


def test_permissions(auth_client, cashier_user, storekeeper, supplier, mag):
    assert auth_client(cashier_user).get("/api/purchasing/orders/").status_code == 403
    assert auth_client(storekeeper).get("/api/purchasing/orders/").status_code == 200
    assert auth_client(storekeeper).post("/api/purchasing/suppliers/", {"name": "X"},
                                         format="json").status_code == 403


def test_reorder_suggestions(supplier, mag):
    cahier = make_article("Cahier", cost=250, alert_threshold=20, max_stock=200)
    stylo = make_article("Stylo", cost=80, alert_threshold=10)
    gomme = make_article("Gomme", alert_threshold=5)
    receive_goods(supplier=supplier, depot=mag, lines=[{"article": cahier, "quantity": 100, "unit_cost": 250},
                                                       {"article": stylo, "quantity": 100, "unit_cost": 80}])
    # 75 cahiers vendus sur 90 jours ≈ 0,83 par jour ; délai 10 jours → point de commande 20 + ⌈8,3⌉ = 29.
    sold_at = timezone.now() - datetime.timedelta(days=10)
    record_movement(cahier, mag, StockMovement.Kind.SALE, -75, occurred_at=sold_at)
    record_movement(stylo, mag, StockMovement.Kind.SALE, -5, occurred_at=sold_at)

    suggestions = {s["article"].name: s for s in reorder_suggestions()}
    assert set(suggestions) == {"Cahier", "Gomme"}
    cahier_line = suggestions["Cahier"]
    assert cahier_line["available"] == 25 and cahier_line["reorder_point"] == 29
    assert cahier_line["suggested_quantity"] == 200 - 25
    assert cahier_line["supplier"] == supplier and cahier_line["unit_cost"] == 250
    assert suggestions["Gomme"]["supplier"] is None

    PurchaseOrder.objects.create(number="BC-T-1", supplier=supplier, depot=mag, order_date=timezone.localdate(),
                                 status=PurchaseOrder.Status.SENT).lines.create(article=cahier, quantity=180,
                                                                               unit_cost=250)
    assert "Cahier" not in {s["article"].name for s in reorder_suggestions()}
    assert gomme.pk in {s["article"].pk for s in reorder_suggestions()}


def test_create_orders_from_suggestions(auth_client, manager_user, supplier, mag):
    cahier, stylo = make_article("Cahier"), make_article("Stylo")
    other = Supplier.objects.create(name="Librairie de France Distribution")
    response = auth_client(manager_user).post("/api/purchasing/suggestions/create-orders/", {
        "depot": str(mag.pk), "items": [
            {"article": str(cahier.pk), "supplier": str(supplier.pk), "quantity": 100, "unit_cost": 250},
            {"article": str(stylo.pk), "supplier": str(other.pk), "quantity": 50, "unit_cost": 80},
        ]}, format="json")
    assert response.status_code == 201, response.content
    assert len(response.json()) == 2
    assert {o["status"] for o in response.json()} == {"DRAFT"}


def test_purchase_order_document(auth_client, manager_user, supplier, mag):
    cahier = make_article("Cahier 100 pages")
    order = create_order(auth_client(manager_user), supplier, mag,
                         [{"article": str(cahier.pk), "quantity": 1200, "unit_cost": 250}])
    html = render_html("purchasing/purchase_order.html", order_document_context(PurchaseOrder.objects.get(
        pk=order["id"])))
    assert order["number"] in html and "Cahier 100 pages" in html
    assert "300 000 FCFA" in html and "SOCIPAP" in html
    response = auth_client(manager_user).get(f"/api/purchasing/orders/{order['id']}/pdf/")
    try:
        import weasyprint  # noqa: F401
    except (ImportError, OSError):
        assert response.status_code == 503
        assert "PDF" in response.json()["detail"]
    else:
        assert response.status_code == 200 and response.content.startswith(b"%PDF")
