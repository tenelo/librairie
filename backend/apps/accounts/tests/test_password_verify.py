"""Accord du gérant par mot de passe (remise ou retour à la caisse)."""
import pytest

pytestmark = pytest.mark.django_db
URL = "/api/auth/password/verify/"


def test_manager_password_authorizes_and_wrong_password_refuses(auth_client, cashier_user, manager_user):
    manager_user.set_password("Gerant-Solide-2026")
    manager_user.save()
    client = auth_client(cashier_user)
    ok = client.post(URL, {"username": manager_user.username, "password": "Gerant-Solide-2026",
                           "permission": "sales.authorize"}, format="json").json()
    assert ok["valid"] is True and ok["has_permission"] is True and ok["user"]["username"] == manager_user.username
    wrong = client.post(URL, {"username": manager_user.username, "password": "faux"}, format="json").json()
    assert wrong == {"valid": False, "has_permission": False, "user": None}
    # Un caissier n'a pas le droit d'autoriser.
    cashier_user.set_password("Caisse-Solide-2026")
    cashier_user.save()
    self_check = client.post(URL, {"username": cashier_user.username, "password": "Caisse-Solide-2026",
                                   "permission": "sales.authorize"}, format="json").json()
    assert self_check["valid"] is True and self_check["has_permission"] is False


def test_profile_name_can_be_changed(auth_client, cashier_user):
    client = auth_client(cashier_user)
    response = client.patch("/api/auth/me/", {"first_name": "Awa", "last_name": "Konan"}, format="json")
    assert response.status_code == 200 and response.json()["full_name"] == "Awa Konan"
