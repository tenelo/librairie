"""Phase 10 : traçage complet, journal infalsifiable, cohérence des permissions, protections."""
import re
import uuid
from pathlib import Path

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.permissions import AllowAny
from rest_framework.test import APIClient

from apps.accounts.catalog import ALL_CODES
from apps.accounts.models import Device
from apps.audit.models import AuditLog
from apps.catalog.tests.factories import make_article
from apps.customers.models import Customer
from apps.sales.models import Sale
from apps.stock.models import Depot

pytestmark = pytest.mark.django_db
FRONTEND = Path(__file__).resolve().parents[4] / "frontend" / "projects" / "backoffice" / "src" / "app"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def push(client, entity, operation, payload, device="C01"):
    response = client.post("/api/sync/push/", {"operations": [{
        "id": str(uuid.uuid4()), "entity": entity, "operation": operation, "payload": payload,
        "client_timestamp": "2026-10-08T09:30:00Z"}]}, format="json", HTTP_X_DEVICE_CODE=device)
    return response.json()["results"][0]


def test_writes_outside_the_api_are_traced_with_user_device_and_dates(cashier_user,
                                                                     django_capture_on_commit_callbacks):
    Device.objects.create(code="C01", name="Caisse 1")
    client = client_for(cashier_user)
    customer_id = str(uuid.uuid4())
    assert push(client, "customer", "create", {"id": customer_id, "name": "Awa Koné", "phone": "0707000001"})["status"] == "ok"
    logs = AuditLog.objects.filter(entity="Customer", entity_id=customer_id)
    assert logs.count() == 1  # pas de doublon avec une éventuelle entrée explicite
    log = logs.get()
    assert log.username == cashier_user.username and log.device.code == "C01"
    assert log.client_timestamp is not None and log.origin == AuditLog.Origin.SYNC

    # Écriture hors requête (commande de gestion, tâche Celery) : origine « système ».
    customer = Customer.objects.get(pk=customer_id)
    customer.phone = "0707000002"
    with django_capture_on_commit_callbacks(execute=True):
        customer.save()
    change = AuditLog.objects.filter(entity="Customer", entity_id=customer_id, action=AuditLog.Action.UPDATE).get()
    assert change.old_values == {"phone": "0707000001"} and change.new_values == {"phone": "0707000002"}
    assert change.origin == AuditLog.Origin.SYSTEM


def test_failed_sync_operation_leaves_no_phantom_entry(cashier_user):
    Device.objects.create(code="C01", name="Caisse 1")
    customer_id = str(uuid.uuid4())
    result = push(client_for(cashier_user), "customer", "create", {"id": customer_id, "phone": "0707"})
    assert result["status"] == "error"
    assert not AuditLog.objects.filter(entity="Customer", entity_id=customer_id).exists()


def test_rest_changes_are_logged_once_with_diff(manager_user):
    article = make_article("Cahier", 400)
    AuditLog.objects.all()  # lecture seule
    client = client_for(manager_user)
    response = client.patch(f"/api/catalog/articles/{article.pk}/", {"name": "Cahier 96 pages"}, format="json")
    assert response.status_code == 200, response.content
    updates = AuditLog.objects.filter(entity="Article", entity_id=str(article.pk), action=AuditLog.Action.UPDATE)
    assert updates.count() == 1 and updates.get().username == "gerant"


def test_audit_log_is_immutable_and_exportable(admin_user):
    from apps.audit.services import log_event

    log = log_event(AuditLog.Action.UPDATE, user=admin_user, entity="Test", entity_id="1", description="x")
    log.description = "falsifié"
    with pytest.raises(PermissionError):
        log.save()
    with pytest.raises(PermissionError):
        log.delete()
    with pytest.raises(PermissionError):
        AuditLog.objects.filter(pk=log.pk).update(description="falsifié")
    with pytest.raises(PermissionError):
        AuditLog.objects.all().delete()
    client = client_for(admin_user)
    assert client.delete(f"/api/audit/logs/{log.pk}/").status_code == 405
    export = client.get("/api/audit/logs/export/", {"entity": "Test"})
    assert export.status_code == 200 and export.content[:2] == b"PK"


def test_sales_cannot_be_deleted(cashier_user):
    sale = Sale(receipt_number="X")
    for method in (sale.delete, sale.soft_delete, sale.hard_delete):
        with pytest.raises(PermissionError):
            method()


def _api_views():
    def walk(patterns, prefix=""):
        for pattern in patterns:
            if isinstance(pattern, URLResolver):
                yield from walk(pattern.url_patterns, prefix + str(pattern.pattern))
            elif isinstance(pattern, URLPattern):
                yield prefix + str(pattern.pattern), pattern.callback
    return [(route, view) for route, view in walk(get_resolver().url_patterns) if route.startswith("api/")]


PUBLIC = {"api/health/", "api/auth/login/", "api/auth/refresh/", "api/auth/register/", "api/settings/public/",
          "api/shop/reference/", "api/shop/articles/", "api/shop/kits/", "api/shop/payments/webhook/",
          "api/schema/", "api/docs/"}


def test_only_whitelisted_endpoints_are_public():
    exposed = []
    for route, view in _api_views():
        cls = getattr(view, "cls", None) or getattr(view, "view_class", None)
        if cls is None or not hasattr(cls, "permission_classes"):
            continue
        if any(p is AllowAny for p in cls.permission_classes):
            normalized = re.sub(r"\^|\$|\(\?P<[^>]+>[^)]+\)|<[^>]+>", "", route).replace("//", "/")
            if not any(normalized.startswith(p.rstrip("/")) for p in PUBLIC):
                exposed.append(route)
    assert exposed == []


def test_frontend_permissions_exist_on_the_server():
    sources = [FRONTEND / "navigation" / "menu.ts", FRONTEND / "app.routes.ts"]
    codes = set()
    for source in sources:
        text = source.read_text(encoding="utf-8")
        codes |= set(re.findall(r"permission: '([a-z_]+\.[a-z_]+)'", text))
        codes |= set(re.findall(r"'([a-z_]+\.[a-z_]+)',\n?\s*\(\) => import", text))
    assert codes, "aucune permission trouvée dans le menu"
    assert codes - set(ALL_CODES) == set()


def test_depot_fixture_exists():
    assert Depot.objects.filter(code="MAG").exists()
