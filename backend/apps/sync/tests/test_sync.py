import uuid

import pytest

from apps.accounts.models import Device
from apps.audit.models import AuditLog
from apps.catalog.models import Article
from apps.catalog.tests.factories import make_article
from apps.purchasing.models import GoodsReceipt, Supplier
from apps.stock.models import Depot, StockMovement
from apps.stock.services import on_hand, record_movement
from apps.sync.models import SyncConflict, SyncOperation
from apps.sync.registry import SyncContext
from apps.sync.services import last_writer_wins
from conftest import make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def storekeeper(db):
    return make_user("magasinier", "MAGASINIER")


def op(entity, operation, payload, ts="2026-10-08T09:15:00Z"):
    return {"id": str(uuid.uuid4()), "entity": entity, "operation": operation, "payload": payload,
            "client_timestamp": ts}


def push(client, operations, device_code=None):
    headers = {"HTTP_X_DEVICE_CODE": device_code} if device_code else {}
    response = client.post("/api/sync/push/", {"operations": operations}, format="json", **headers)
    assert response.status_code == 200, response.content
    return response.json()["results"]


def test_push_is_idempotent(auth_client, storekeeper, mag):
    cahier = make_article("Cahier")
    record_movement(cahier, mag, StockMovement.Kind.PURCHASE, 10)
    loss = op("stock_adjustment", "create", {"article": str(cahier.pk), "depot": str(mag.pk), "kind": "LOSS",
                                             "quantity": 2, "reason": "Déchirés"})
    client = auth_client(storekeeper)
    first = push(client, [loss])
    replay = push(client, [loss])
    assert first[0]["status"] == "ok" and replay[0]["status"] == "ok" and replay[0]["replayed"]
    assert on_hand(cahier, mag) == 8
    assert SyncOperation.objects.count() == 1


def test_two_offline_terminals_converge(auth_client, storekeeper, mag):
    """Deux terminaux hors ligne retirent le même article : les mouvements s'additionnent sans conflit."""
    Device.objects.create(code="C01", name="Caisse 1")
    Device.objects.create(code="C02", name="Caisse 2")
    stylo = make_article("Stylo")
    record_movement(stylo, mag, StockMovement.Kind.PURCHASE, 5)
    client = auth_client(storekeeper)
    payload = {"article": str(stylo.pk), "depot": str(mag.pk), "kind": "LOSS", "reason": "Casse"}
    push(client, [op("stock_adjustment", "create", {**payload, "quantity": 3})], "C01")
    push(client, [op("stock_adjustment", "create", {**payload, "quantity": 4})], "C02")
    assert on_hand(stylo, mag) == -2
    movements = StockMovement.objects.filter(article=stylo, kind="LOSS")
    assert sorted(m.device.code for m in movements) == ["C01", "C02"]
    assert all(m.client_timestamp is not None for m in movements)
    assert Device.objects.get(code="C02").last_sync_at is not None


def test_errors_are_isolated_and_reported(auth_client, storekeeper, mag):
    cahier = make_article("Cahier")
    results = push(auth_client(storekeeper), [
        op("stock_adjustment", "create", {"article": str(cahier.pk), "depot": str(mag.pk), "kind": "LOSS",
                                          "quantity": 1, "reason": ""}),
        op("inconnu", "create", {}),
        op("stock_adjustment", "create", {"article": str(cahier.pk), "depot": str(mag.pk), "kind": "LOSS",
                                          "quantity": 1, "reason": "Abîmé"}),
    ])
    assert [r["status"] for r in results] == ["error", "error", "ok"]
    assert "motif" in results[0]["error"]
    assert AuditLog.objects.filter(entity="SyncOperation").count() == 2


def test_permission_checked_per_operation(auth_client, cashier_user, mag):
    cahier = make_article("Cahier")
    results = push(auth_client(cashier_user), [op("stock_adjustment", "create", {
        "article": str(cahier.pk), "depot": str(mag.pk), "kind": "LOSS", "quantity": 1, "reason": "x"})])
    assert results[0]["status"] == "error" and "stock.manage" in results[0]["error"]


def test_offline_goods_receipt(auth_client, storekeeper, mag):
    supplier = Supplier.objects.create(name="SOCIPAP")
    cahier = make_article("Cahier", cost=0)
    receipt_id = str(uuid.uuid4())
    operation = op("goods_receipt", "create", {"id": receipt_id, "supplier": str(supplier.pk), "depot": str(mag.pk),
                                               "lines": [{"article": str(cahier.pk), "quantity": 12, "unit_cost": 240}]})
    client = auth_client(storekeeper)
    assert push(client, [operation])[0]["status"] == "ok"
    # Le terminal renvoie l'opération sous un autre identifiant d'outbox : la réception n'est pas doublée.
    assert push(client, [{**operation, "id": str(uuid.uuid4())}])[0]["status"] == "ok"
    assert GoodsReceipt.objects.count() == 1 and on_hand(cahier, mag) == 12
    cahier.refresh_from_db()
    assert cahier.avg_cost == 240


def test_pull_returns_changes_with_cursor_and_deletions(auth_client, cashier_user):
    client = auth_client(cashier_user)
    initial = client.get("/api/sync/pull/?since=0&limit=1000").json()
    assert not initial["has_more"]
    assert {"levels", "depots", "settings", "units", "categories"} <= set(initial["changes"])
    cursor = initial["cursor"]

    cahier = make_article("Cahier")
    stylo = make_article("Stylo")
    stylo.soft_delete()
    delta = client.get(f"/api/sync/pull/?since={cursor}").json()
    rows = {row["name"]: row for row in delta["changes"]["articles"]}
    assert rows["Cahier"]["is_deleted"] is False and rows["Stylo"]["is_deleted"] is True
    assert client.get(f"/api/sync/pull/?since={delta['cursor']}").json()["changes"] == {}
    assert cahier.sync_version <= delta["cursor"]


def test_pull_pagination_has_no_gaps(auth_client, cashier_user):
    client = auth_client(cashier_user)
    base = client.get("/api/sync/pull/?since=0&limit=1000").json()["cursor"]
    created = {make_article(f"Article {i}").pk for i in range(7)}
    seen, cursor, pages = set(), base, 0
    while True:
        page = client.get(f"/api/sync/pull/?since={cursor}&limit=3").json()
        pages += 1
        seen |= {row["id"] for rows in page["changes"].values() for row in rows if "code" in row and "type" in row}
        cursor = page["cursor"]
        if not page["has_more"]:
            break
    assert {str(pk) for pk in created} <= seen
    assert pages >= 3


def test_pull_filters_entities_by_permission(auth_client, client_user, storekeeper):
    assert auth_client(client_user).get("/api/sync/pull/").status_code == 403
    changes = auth_client(storekeeper).get("/api/sync/pull/?entities=depots").json()["changes"]
    assert set(changes) == {"depots"}


def test_last_writer_wins(storekeeper):
    article = make_article("Cahier")
    operation = SyncOperation.objects.create(id=uuid.uuid4(), entity="test", operation="update", payload={},
                                             status="ok")
    context = SyncContext(user=storekeeper, device=None, client_timestamp=None, operation_id=operation.pk)
    from django.utils import timezone

    serialize = lambda a: {"name": a.name}  # noqa: E731
    stale = article.sync_version - 1
    from apps.sync.registry import SyncConflictError

    with pytest.raises(SyncConflictError):
        last_writer_wins(instance=article, changes={"name": "Ancien"}, base_version=stale,
                         client_timestamp=timezone.now() - timezone.timedelta(days=1), context=context,
                         serialize=serialize)
    result = last_writer_wins(instance=article, changes={"name": "Plus récent"}, base_version=stale,
                              client_timestamp=timezone.now() + timezone.timedelta(minutes=1), context=context,
                              serialize=serialize)
    assert result == {"name": "Plus récent"}
    assert list(SyncConflict.objects.values_list("resolution", flat=True).order_by("created_at")) == ["server",
                                                                                                      "client"]
    assert AuditLog.objects.filter(action=AuditLog.Action.SYNC_CONFLICT).count() == 2
    Article.objects.get(pk=article.pk)


def test_sync_screens_api(auth_client, admin_user, cashier_user):
    assert auth_client(admin_user).get("/api/sync/state/").status_code == 200
    assert auth_client(cashier_user).get("/api/sync/conflicts/").status_code == 200
    assert auth_client(cashier_user).get("/api/sync/operations/").status_code == 200


def test_offline_audit_events(auth_client, cashier_user):
    from apps.accounts.models import Device

    Device.objects.create(code="C03", name="Caisse 3")
    results = push(auth_client(cashier_user), [
        op("audit_event", "create", {"action": "PIN_UNLOCK", "username": "caisse1"}),
        op("audit_event", "create", {"action": "PRICE_CHANGE", "username": "caisse1"}),
    ], "C03")
    assert [r["status"] for r in results] == ["ok", "error"]
    log = AuditLog.objects.get(action=AuditLog.Action.PIN_UNLOCK)
    assert log.origin == "SYNC" and log.device.code == "C03" and log.client_timestamp is not None
    assert log.user == cashier_user


def test_open_purchase_orders_are_pulled_with_remaining_quantities(auth_client, storekeeper, mag):
    from django.utils import timezone

    from apps.purchasing.models import PurchaseOrder
    from apps.purchasing.services import receive_goods

    supplier = Supplier.objects.create(name="SOCIPAP")
    cahier = make_article("Cahier")
    order = PurchaseOrder.objects.create(number="BC-T-9", supplier=supplier, depot=mag, order_date=timezone.localdate(),
                                         status=PurchaseOrder.Status.SENT)
    line = order.lines.create(article=cahier, quantity=10, unit_cost=200)
    client = auth_client(storekeeper)
    rows = client.get("/api/sync/pull/?entities=purchase_orders").json()["changes"]["purchase_orders"]
    assert rows[0]["is_deleted"] is False and rows[0]["lines"][0]["remaining"] == 10
    cursor = client.get("/api/sync/pull/").json()["cursor"]
    receive_goods(supplier=supplier, depot=mag, purchase_order=order,
                  lines=[{"article": cahier, "quantity": 10, "unit_cost": 200, "order_line": line}])
    rows = client.get(f"/api/sync/pull/?since={cursor}").json()["changes"]["purchase_orders"]
    assert rows[0]["is_deleted"] is True  # bon reçu : retiré des terminaux
