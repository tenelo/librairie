import uuid

import pytest

from apps.audit.models import AuditLog
from apps.catalog.models import Category
from apps.catalog.tests.factories import make_article
from apps.inventory.models import InventorySession
from apps.stock.models import Depot, StockMovement
from apps.stock.services import on_hand, record_movement
from conftest import make_user
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def counter_user(db):
    return make_user("inventoriste", "INVENTORISTE")


def client_for(user):
    """Client API propre à un utilisateur (la fixture `auth_client` partage un seul client)."""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def push_count(client, session_id, article, quantity, round_=1, ts="2099-01-01T00:00:00Z"):
    response = client.post("/api/sync/push/", {"operations": [{
        "id": str(uuid.uuid4()), "entity": "inventory_count", "operation": "create", "client_timestamp": ts,
        "payload": {"id": str(uuid.uuid4()), "session": session_id, "article": str(article.pk), "quantity": quantity,
                    "round": round_}}]}, format="json")
    return response.json()["results"][0]


def create_session(client, mag, **extra):
    payload = {"name": "Inventaire de rentrée", "kind": "FULL", "depot": str(mag.pk), **extra}
    response = client.post("/api/inventory/sessions/", payload, format="json")
    assert response.status_code == 201, response.content
    return response.json()


def test_full_cycle_with_sales_during_inventory(auth_client, manager_user, counter_user, mag):
    cahier, stylo, gomme = make_article("Cahier"), make_article("Stylo", cost=80), make_article("Gomme", cost=50)
    record_movement(cahier, mag, StockMovement.Kind.PURCHASE, 50)
    record_movement(stylo, mag, StockMovement.Kind.PURCHASE, 30)
    manager = client_for(manager_user)
    session = create_session(manager, mag, assignments=[{"user": "inventoriste", "zone": "Rayon cahiers"}])
    assert session["number"].startswith("INV-") and session["assignments"][0]["user"] == "inventoriste"
    started = manager.post(f"/api/inventory/sessions/{session['id']}/start/").json()
    assert started["status"] == "COUNTING" and started["summary"]["articles"] == 3

    # Pendant le comptage : vente de 5 cahiers (après le gel, avant le comptage).
    record_movement(cahier, mag, StockMovement.Kind.SALE, -5)
    counter = client_for(counter_user)
    assert push_count(counter, session["id"], cahier, 30)["status"] == "ok"
    assert push_count(counter, session["id"], cahier, 14)["status"] == "ok"  # comptages additionnés
    assert push_count(counter, session["id"], stylo, 28)["status"] == "ok"
    assert counter.post(f"/api/inventory/sessions/{session['id']}/validate/").status_code == 403

    report = {line["name"]: line for line in manager.get(f"/api/inventory/sessions/{session['id']}/report/").json()["lines"]}
    assert report["Cahier"]["theoretical"] == 50 and report["Cahier"]["movements_during"] == -5
    assert report["Cahier"]["expected"] == 45 and report["Cahier"]["counted"] == 44 and report["Cahier"]["variance"] == -1
    assert report["Stylo"]["variance"] == -2 and report["Stylo"]["variance_value"] == -160
    assert report["Gomme"]["counted"] is None

    validated = manager.post(f"/api/inventory/sessions/{session['id']}/validate/", {}, format="json")
    assert validated.status_code == 200, validated.content
    assert on_hand(cahier, mag) == 44 and on_hand(stylo, mag) == 28 and on_hand(gomme, mag) == 0
    assert AuditLog.objects.filter(action=AuditLog.Action.INVENTORY_VALIDATE).exists()
    assert push_count(counter, session["id"], cahier, 1)["status"] == "error"  # comptage clos
    assert manager.post(f"/api/inventory/sessions/{session['id']}/close/").json()["status"] == "CLOSED"
    final = manager.get(f"/api/inventory/sessions/{session['id']}/report/").json()
    assert final["summary"]["variance_value"] == -1 * cahier.avg_cost - 160


def test_double_count_required_above_threshold(auth_client, manager_user, counter_user, mag):
    cahier = make_article("Cahier")
    record_movement(cahier, mag, StockMovement.Kind.PURCHASE, 100)
    manager = client_for(manager_user)
    session = create_session(manager, mag, counting_mode="DOUBLE", double_count_threshold=3)
    manager.post(f"/api/inventory/sessions/{session['id']}/start/")
    counter = client_for(counter_user)
    push_count(counter, session["id"], cahier, 90)
    report = manager.get(f"/api/inventory/sessions/{session['id']}/report/").json()
    assert report["lines"][0]["needs_recount"] is True and report["summary"]["to_recount"] == 1
    assert manager.post(f"/api/inventory/sessions/{session['id']}/validate/").status_code == 400
    push_count(counter, session["id"], cahier, 97, round_=2)
    assert manager.post(f"/api/inventory/sessions/{session['id']}/validate/").status_code == 200
    assert on_hand(cahier, mag) == 97


def test_partial_by_category_and_cycle_scopes(auth_client, manager_user, mag):
    cahiers = Category.objects.get(name="Cahiers", parent=None)
    sub = Category.objects.create(name="Petits cahiers", parent=cahiers)
    a, b, c = make_article("Cahier A", category=sub), make_article("Stylo"), make_article("Règle")
    manager = client_for(manager_user)
    partial = create_session(manager, mag, kind="PARTIAL", categories=[str(cahiers.pk)])
    assert manager.post(f"/api/inventory/sessions/{partial['id']}/start/").json()["summary"]["articles"] == 1
    cycle = create_session(manager, mag, kind="CYCLE", articles=[str(b.pk), str(c.pk)])
    started = manager.post(f"/api/inventory/sessions/{cycle['id']}/start/").json()
    assert started["summary"]["articles"] == 2
    assert manager.patch(f"/api/inventory/sessions/{cycle['id']}/", {"kind": "FULL"}, format="json").status_code == 400
    empty_cycle = manager.post("/api/inventory/sessions/", {"name": "x", "kind": "CYCLE", "depot": str(mag.pk)},
                               format="json")
    assert empty_cycle.status_code == 400
    assert a  # utilisé dans le périmètre partiel


def test_uncounted_as_zero_and_exports(auth_client, manager_user, mag):
    cahier = make_article("Cahier", cost=200)
    record_movement(cahier, mag, StockMovement.Kind.PURCHASE, 5)
    manager = client_for(manager_user)
    session = create_session(manager, mag)
    manager.post(f"/api/inventory/sessions/{session['id']}/start/")
    manager.post(f"/api/inventory/sessions/{session['id']}/validate/", {"uncounted_as_zero": True}, format="json")
    assert on_hand(cahier, mag) == 0
    excel = manager.get(f"/api/inventory/sessions/{session['id']}/export/")
    assert excel.status_code == 200 and excel.content[:2] == b"PK"
    pdf = manager.get(f"/api/inventory/sessions/{session['id']}/pdf/")
    assert pdf.status_code in (200, 503)


def test_counts_are_pulled_for_offline_counting(auth_client, manager_user, counter_user, mag):
    make_article("Cahier")
    manager = client_for(manager_user)
    session = create_session(manager, mag)
    manager.post(f"/api/inventory/sessions/{session['id']}/start/")
    rows = client_for(counter_user).get("/api/sync/pull/?entities=inventory_sessions").json()["changes"][
        "inventory_sessions"]
    assert rows[0]["is_deleted"] is False and len(rows[0]["articles"]) == 1
    manager.post(f"/api/inventory/sessions/{session['id']}/cancel/")
    assert InventorySession.objects.get(pk=session["id"]).status == "CANCELLED"
