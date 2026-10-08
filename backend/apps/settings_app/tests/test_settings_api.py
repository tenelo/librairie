import pytest

from apps.audit.models import AuditLog

pytestmark = pytest.mark.django_db


def test_public_settings_without_authentication(api_client):
    response = api_client.get("/api/settings/public/")
    assert response.status_code == 200
    assert response.json()["name"] == "Ma Librairie"
    assert "taxpayer_number" not in response.json()


def test_staff_reads_admin_updates(auth_client, cashier_user, admin_user):
    cashier = auth_client(cashier_user)
    body = cashier.get("/api/settings/library/").json()
    assert body["currency"] == {"code": "XOF", "label": "FCFA", "decimals": 0}
    assert cashier.patch("/api/settings/library/", {"name": "Pirate"}, format="json").status_code == 403

    admin = auth_client(admin_user)
    response = admin.patch(
        "/api/settings/library/", {"name": "Librairie de la Riviera", "offline_max_hours": 48}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["offline_max_hours"] == 48
    log = AuditLog.objects.get(entity="LibrarySettings")
    assert log.old_values == {"name": "Ma Librairie", "offline_max_hours": 72}
    assert log.new_values == {"name": "Librairie de la Riviera", "offline_max_hours": 48}


def test_effective_offline_hours_follow_settings(auth_client, admin_user, cashier_user):
    auth_client(admin_user).patch("/api/settings/library/", {"offline_max_hours": 24}, format="json")
    assert auth_client(cashier_user).get("/api/auth/me/").json()["offline_max_hours"] == 24
