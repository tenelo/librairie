import pytest

from apps.audit.models import AuditLog
from apps.audit.services import diff_values, log_event

pytestmark = pytest.mark.django_db


def test_diff_values_keeps_only_changes():
    old, new = diff_values({"a": 1, "b": 2}, {"a": 1, "b": 3, "c": 4})
    assert old == {"b": 2, "c": None}
    assert new == {"b": 3, "c": 4}


def test_audit_log_is_read_only_and_filterable(auth_client, admin_user, cashier_user):
    log_event(AuditLog.Action.LOGIN, user=cashier_user)
    log_event(AuditLog.Action.REPRINT, user=cashier_user, entity="Sale", entity_id="C02-20261008-0047")
    client = auth_client(admin_user)

    all_logs = client.get("/api/audit/logs/").json()
    assert all_logs["count"] == 2
    connections = client.get("/api/audit/logs/?connections=true").json()
    assert [row["action"] for row in connections["results"]] == ["LOGIN"]
    search = client.get("/api/audit/logs/?search=C02-20261008").json()
    assert search["count"] == 1

    log_id = all_logs["results"][0]["id"]
    assert client.delete(f"/api/audit/logs/{log_id}/").status_code == 405
    assert client.patch(f"/api/audit/logs/{log_id}/", {"action": "LOGOUT"}, format="json").status_code == 405
    assert client.post("/api/audit/logs/", {}, format="json").status_code == 405


def test_cashier_cannot_read_audit(auth_client, cashier_user):
    assert auth_client(cashier_user).get("/api/audit/logs/").status_code == 403
