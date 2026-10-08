import pytest

from apps.accounts.models import Device, User
from apps.audit.models import AuditLog

pytestmark = pytest.mark.django_db


def test_only_admin_manages_users(auth_client, admin_user, manager_user, cashier_user):
    assert auth_client(cashier_user).get("/api/accounts/users/").status_code == 403
    assert auth_client(manager_user).get("/api/accounts/users/").status_code == 403
    response = auth_client(admin_user).get("/api/accounts/users/")
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_admin_creates_and_deactivates_user(auth_client, admin_user):
    client = auth_client(admin_user)
    response = client.post(
        "/api/accounts/users/",
        {"username": "magasin1", "first_name": "Ali", "last_name": "Diallo", "role": "MAGASINIER",
         "password": "Reserve-Stock-2026"},
        format="json",
    )
    assert response.status_code == 201, response.content
    user = User.objects.get(username="magasin1")
    assert user.has_app_perm("purchasing.receive")

    response = client.post(f"/api/accounts/users/{user.id}/deactivate/")
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.is_active is False
    assert client.delete(f"/api/accounts/users/{user.id}/").status_code == 405


def test_password_required_on_creation(auth_client, admin_user):
    response = auth_client(admin_user).post(
        "/api/accounts/users/", {"username": "x", "role": "CAISSIER"}, format="json"
    )
    assert response.status_code == 400


def test_role_matrix_is_editable_by_admin_and_audited(auth_client, admin_user, cashier_user):
    client = auth_client(admin_user)
    roles = client.get("/api/accounts/roles/").json()
    caissier = next(r for r in roles if r["code"] == "CAISSIER")
    new_perms = caissier["permissions"] + ["stats.view"]
    response = client.patch(f"/api/accounts/roles/{caissier['id']}/", {"permissions": new_perms}, format="json")
    assert response.status_code == 200
    cashier_user = User.objects.get(pk=cashier_user.pk)
    assert cashier_user.has_app_perm("stats.view")
    log = AuditLog.objects.get(action=AuditLog.Action.PERMISSIONS_CHANGE)
    assert "stats.view" in log.new_values["permissions"]
    assert "stats.view" not in log.old_values["permissions"]

    assert auth_client(cashier_user).patch(
        f"/api/accounts/roles/{caissier['id']}/", {"max_discount_percent": 90}, format="json"
    ).status_code == 403


def test_device_registration_and_check(auth_client, admin_user, cashier_user):
    client = auth_client(admin_user)
    response = client.post("/api/accounts/devices/", {"code": "c05", "name": "Caisse 5"}, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["code"] == "C05"
    assert Device.objects.get(code="C05").registered_by == admin_user
    duplicate = client.post("/api/accounts/devices/", {"code": "C05", "name": "Doublon"}, format="json")
    assert duplicate.status_code == 400

    cashier = auth_client(cashier_user)
    assert cashier.get("/api/accounts/devices/").status_code == 403
    assert cashier.get("/api/accounts/devices/check/?code=c05").status_code == 200
    assert cashier.get("/api/accounts/devices/check/?code=ZZ9").status_code == 404


def test_client_has_no_backoffice_access(auth_client, client_user):
    client = auth_client(client_user)
    assert client.get("/api/accounts/roles/").status_code == 403
    assert client.get("/api/settings/library/").status_code == 403
    assert client.get("/api/audit/logs/").status_code == 403
