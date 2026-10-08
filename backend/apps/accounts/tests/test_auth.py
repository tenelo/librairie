import pytest

from apps.audit.models import AuditLog
from conftest import PASSWORD

pytestmark = pytest.mark.django_db


def login(client, identifier, password=PASSWORD, app="backoffice", **headers):
    return client.post(
        "/api/auth/login/", {"identifier": identifier, "password": password, "app": app}, format="json", **headers
    )


def test_login_returns_tokens_and_offline_profile(api_client, cashier_user, device):
    response = login(api_client, "caisse1", HTTP_X_DEVICE_CODE="c02")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["access"] and body["refresh"]
    user = body["user"]
    assert user["role"]["code"] == "CAISSIER"
    assert "sales.create" in user["permissions"]
    assert user["offline_max_hours"] == 72
    assert user["has_pin"] is False

    log = AuditLog.objects.get(action=AuditLog.Action.LOGIN)
    assert log.user == cashier_user
    assert log.device == device
    assert log.role_code == "CAISSIER"
    device.refresh_from_db()
    assert device.last_seen_at is not None


def test_login_with_phone_number(api_client, cashier_user):
    response = login(api_client, "+225 07 01 02 03 04")
    assert response.status_code == 200


def test_failed_login_is_audited_and_not_rolled_back(api_client, cashier_user):
    response = login(api_client, "caisse1", "mauvais")
    assert response.status_code == 401
    assert response.json()["detail"] == "Identifiant ou mot de passe incorrect."
    log = AuditLog.objects.get(action=AuditLog.Action.LOGIN_FAILED)
    assert log.username == "caisse1"


def test_client_cannot_log_into_backoffice(api_client, client_user):
    assert login(api_client, "0708091011").status_code == 403
    assert login(api_client, "0708091011", app="boutique").status_code == 200


def test_refresh_rotates_and_blacklists(api_client, cashier_user):
    tokens = login(api_client, "caisse1").json()
    first = api_client.post("/api/auth/refresh/", {"refresh": tokens["refresh"]}, format="json")
    assert first.status_code == 200
    assert first.json()["refresh"] != tokens["refresh"]
    replay = api_client.post("/api/auth/refresh/", {"refresh": tokens["refresh"]}, format="json")
    assert replay.status_code == 401


def test_logout_blacklists_refresh_token(api_client, cashier_user):
    tokens = login(api_client, "caisse1").json()
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert api_client.post("/api/auth/logout/", {"refresh": tokens["refresh"]}, format="json").status_code == 205
    api_client.credentials()
    assert api_client.post("/api/auth/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code == 401
    assert AuditLog.objects.filter(action=AuditLog.Action.LOGOUT).exists()


def test_me_requires_authentication(api_client):
    assert api_client.get("/api/auth/me/").status_code == 401


def test_register_creates_client(api_client):
    response = api_client.post(
        "/api/auth/register/",
        {"first_name": "Adjoua", "last_name": "Bamba", "phone": "05 44 33 22 11", "password": "Cahier-Bleu-2026"},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert response.json()["user"]["role"]["code"] == "CLIENT"
    duplicate = api_client.post(
        "/api/auth/register/",
        {"first_name": "X", "last_name": "Y", "phone": "0544332211", "password": "Cahier-Bleu-2026"},
        format="json",
    )
    assert duplicate.status_code == 400


def test_set_and_verify_pin(auth_client, cashier_user, manager_user):
    client = auth_client(manager_user)
    assert client.post("/api/auth/me/pin/", {"password": "faux", "pin": "1234"}, format="json").status_code == 400
    assert client.post("/api/auth/me/pin/", {"password": PASSWORD, "pin": "1234"}, format="json").status_code == 204
    assert client.post("/api/auth/me/pin/", {"password": PASSWORD, "pin": "12"}, format="json").status_code == 400

    cashier = auth_client(cashier_user)
    ok = cashier.post(
        "/api/auth/pin/verify/", {"username": "gerant", "pin": "1234", "permission": "sales.authorize"}, format="json"
    ).json()
    assert ok["valid"] is True and ok["has_permission"] is True
    ko = cashier.post("/api/auth/pin/verify/", {"username": "gerant", "pin": "9999"}, format="json").json()
    assert ko["valid"] is False
    assert AuditLog.objects.filter(action=AuditLog.Action.PIN_UNLOCK).count() == 1
    assert AuditLog.objects.filter(action=AuditLog.Action.PIN_FAILED).count() == 1


def test_change_password(auth_client, cashier_user):
    client = auth_client(cashier_user)
    response = client.post(
        "/api/auth/me/password/",
        {"current_password": PASSWORD, "new_password": "Nouveau-Secret-2026"},
        format="json",
    )
    assert response.status_code == 204
    cashier_user.refresh_from_db()
    assert cashier_user.check_password("Nouveau-Secret-2026")
