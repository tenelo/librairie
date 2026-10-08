"""Fixtures partagées par toute la suite de tests."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.catalog import ADMIN, CAISSIER, CLIENT, GERANT
from apps.accounts.models import Device, Role, User

PASSWORD = "Motdepasse-Solide-2026"


@pytest.fixture
def api_client():
    return APIClient()


def make_user(username, role_code, **extra):
    user = User(username=username, role=Role.objects.get(code=role_code), **extra)
    user.set_password(PASSWORD)
    user.save()
    return user


@pytest.fixture
def admin_user(db):
    return make_user("admin", ADMIN, first_name="Awa", last_name="Koné")


@pytest.fixture
def manager_user(db):
    return make_user("gerant", GERANT, first_name="Yao", last_name="Kouassi")


@pytest.fixture
def cashier_user(db):
    return make_user("caisse1", CAISSIER, first_name="Aya", last_name="Traoré", phone="+225 07 01 02 03 04")


@pytest.fixture
def client_user(db):
    return make_user("0708091011", CLIENT, phone="0708091011", first_name="Koffi", last_name="N'Guessan")


@pytest.fixture
def device(db):
    return Device.objects.create(code="C02", name="Caisse 2", kind="CAISSE")


@pytest.fixture
def auth_client(api_client):
    """Retourne une fonction qui authentifie le client API pour un utilisateur donné."""

    def _login(user):
        api_client.force_authenticate(user=user)
        return api_client

    return _login
