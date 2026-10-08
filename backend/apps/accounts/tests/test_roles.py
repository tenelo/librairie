import pytest

from apps.accounts.catalog import ALL_CODES, DEFAULT_ROLE_MATRIX, sync_permissions_and_roles
from apps.accounts.models import Permission, Role

pytestmark = pytest.mark.django_db


def test_migration_seeds_every_permission_and_role():
    assert set(Permission.objects.values_list("code", flat=True)) == set(ALL_CODES)
    assert set(Role.objects.values_list("code", flat=True)) == set(DEFAULT_ROLE_MATRIX)


@pytest.mark.parametrize(
    "role,allowed,denied",
    [
        ("CAISSIER", ["sales.create", "cash.open_close"], ["inventory.validate", "catalog.prices", "stats.view"]),
        ("MAGASINIER", ["purchasing.receive", "stock.transfer"], ["sales.create", "accounts.manage_users"]),
        ("PREPARATEUR", ["orders.prepare"], ["orders.confirm", "sales.create"]),
        ("INVENTORISTE", ["inventory.count"], ["inventory.validate"]),
        ("GERANT", ["inventory.validate", "catalog.prices", "stats.view", "sales.authorize"],
         ["accounts.manage_users", "settings.manage"]),
        ("ADMIN", ["accounts.manage_users", "settings.manage", "inventory.validate"], ["shop.order"]),
        ("CLIENT", ["shop.order"], ["dashboard.view", "sales.create"]),
    ],
)
def test_default_matrix(role, allowed, denied):
    codes = set(Role.objects.get(code=role).permissions.values_list("code", flat=True))
    for code in allowed:
        assert code in codes, f"{role} devrait avoir {code}"
    for code in denied:
        assert code not in codes, f"{role} ne devrait pas avoir {code}"


def test_sync_does_not_override_admin_choices_unless_reset():
    caissier = Role.objects.get(code="CAISSIER")
    caissier.permissions.add(Permission.objects.get(code="stats.view"))
    sync_permissions_and_roles(Permission, Role)
    assert caissier.permissions.filter(code="stats.view").exists()
    sync_permissions_and_roles(Permission, Role, reset=True)
    assert not caissier.permissions.filter(code="stats.view").exists()


def test_user_permission_helpers(cashier_user, admin_user):
    assert cashier_user.has_app_perm("sales.create")
    assert not cashier_user.has_app_perm("accounts.manage_users")
    assert admin_user.has_app_perm("accounts.manage_users")
    cashier_user.is_active = False
    assert not cashier_user.has_app_perm("sales.create")


def test_phone_is_normalized(cashier_user):
    assert cashier_user.phone == "+2250701020304"
