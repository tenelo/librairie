"""Plusieurs librairies : référentiel, rattachement du personnel, cloisonnement et prix propres."""
import pytest
from django.utils import timezone

from apps.accounts.models import Permission, Role
from apps.catalog.models import ArticleLibraryPrice
from apps.catalog.tests.factories import make_article
from apps.reports import services as reports
from apps.sales.models import SaleLine
from apps.sales.services import catalog_unit_price
from apps.stock.models import Depot, Library, StockMovement
from apps.stock.services import record_movement
from conftest import make_user

pytestmark = pytest.mark.django_db
Kind = StockMovement.Kind


@pytest.fixture
def libraries():
    """Librairie A (dépôt MAG), librairie B (dépôt BMAG) et entrepôt général (RES, sans librairie)."""
    lib_a = Library.objects.create(name="Librairie A", location="Cocody")
    lib_b = Library.objects.create(name="Librairie B", location="Yopougon")
    mag = Depot.objects.get(code="BTQ")
    mag.library = lib_a
    mag.save()
    bmag = Depot.objects.create(code="BMAG", name="Magasin B", library=lib_b)
    central = Depot.objects.get(code="MAG")
    return lib_a, lib_b, mag, bmag, central


@pytest.fixture
def stocked(libraries):
    """10 cahiers au total : 7 en librairie A, 0 en B, 3 à l'entrepôt général."""
    _lib_a, _lib_b, mag, _bmag, central = libraries
    cahier = make_article("Cahier 200 pages", retail=500, cost=300)
    record_movement(cahier, mag, Kind.PURCHASE, 7)
    record_movement(cahier, central, Kind.PURCHASE, 3)
    return cahier


def quantities(client, query=""):
    rows = client.get(f"/api/stock/state/{query}").json()["results"]
    return {row["name"]: row["quantity"] for row in rows}


def test_admin_manages_libraries_and_others_cannot(auth_client, admin_user, cashier_user):
    client = auth_client(admin_user)
    response = client.post("/api/stock/libraries/", {"name": "Librairie Centre", "location": "Plateau"},
                           format="json")
    assert response.status_code == 201, response.json()
    assert client.post("/api/stock/libraries/", {"name": "librairie centre"}, format="json").status_code == 400
    rows = client.get("/api/stock/libraries/").json()
    assert rows[0]["name"] == "Librairie Centre" and rows[0]["location"] == "Plateau"

    cashier = auth_client(cashier_user)
    assert cashier.get("/api/stock/libraries/").status_code == 200
    assert cashier.post("/api/stock/libraries/", {"name": "Pirate"}, format="json").status_code == 403


def test_library_in_use_cannot_be_deleted(auth_client, admin_user, libraries):
    lib_a = libraries[0]
    response = auth_client(admin_user).delete(f"/api/stock/libraries/{lib_a.pk}/")
    assert response.status_code == 400


def test_staff_user_must_be_attached_to_a_library(auth_client, admin_user, libraries):
    lib_a = libraries[0]
    client = auth_client(admin_user)
    payload = {"username": "awa", "role": "CAISSIER", "password": "Motdepasse-Solide-2026"}
    response = client.post("/api/accounts/users/", payload, format="json")
    assert response.status_code == 400 and "library" in response.json()

    response = client.post("/api/accounts/users/", {**payload, "library": str(lib_a.pk)}, format="json")
    assert response.status_code == 201, response.json()
    assert response.json()["library_name"] == "Librairie A"
    # L'administrateur n'a pas besoin de librairie.
    response = client.post("/api/accounts/users/", {"username": "boss", "role": "ADMIN",
                                                    "password": "Motdepasse-Solide-2026"}, format="json")
    assert response.status_code == 201


def test_profile_tells_which_library(auth_client, admin_user, libraries):
    lib_a = libraries[0]
    employee = make_user("awa", "CAISSIER", library=lib_a)
    me = auth_client(employee).get("/api/auth/me/").json()
    assert me["library"]["name"] == "Librairie A" and me["all_libraries"] is False
    me = auth_client(admin_user).get("/api/auth/me/").json()
    assert me["library"] is None and me["all_libraries"] is True


def test_employee_sees_own_library_stock_and_central_warehouse(auth_client, libraries, stocked):
    lib_a, lib_b, mag, bmag, _central = libraries
    employee_b = auth_client(make_user("bamba", "CAISSIER", library=lib_b))

    # Par défaut : le stock de sa librairie (0 en B).
    assert quantities(employee_b)["Cahier 200 pages"] == 0
    # L'entrepôt général est visible : 3 cahiers à aller chercher.
    assert quantities(employee_b, "?library=central")["Cahier 200 pages"] == 3
    # Pas le stock de la librairie A sans la permission.
    assert employee_b.get(f"/api/stock/state/?library={lib_a.pk}").status_code == 403
    assert employee_b.get(f"/api/stock/state/?depot={mag.pk}").status_code == 403
    movements = employee_b.get("/api/stock/movements/").json()["results"]
    assert {m["depot"] for m in movements} == {str(_central.pk)}


def test_permission_opens_other_libraries_stock(auth_client, libraries, stocked):
    lib_a, lib_b, *_ = libraries
    role = Role.objects.get(code="CAISSIER")
    role.permissions.add(Permission.objects.get(code="stock.view_all_libraries"))
    employee_b = auth_client(make_user("bamba", "CAISSIER", library=lib_b))
    assert quantities(employee_b, f"?library={lib_a.pk}")["Cahier 200 pages"] == 7


def test_admin_sees_global_stock(auth_client, admin_user, libraries, stocked):
    lib_a = libraries[0]
    client = auth_client(admin_user)
    assert quantities(client)["Cahier 200 pages"] == 10
    assert quantities(client, f"?library={lib_a.pk}")["Cahier 200 pages"] == 7


def test_transfer_from_central_warehouse_is_traced(auth_client, libraries, stocked):
    _lib_a, lib_b, mag, bmag, central = libraries
    employee_b = auth_client(make_user("bamba", "MAGASINIER", library=lib_b))
    line = [{"article": str(stocked.pk), "quantity": 3}]
    # B ne peut pas organiser un transfert entre A et l'entrepôt.
    refused = employee_b.post("/api/stock/transfers/", {"from_depot": str(central.pk), "to_depot": str(mag.pk),
                                                         "lines": line}, format="json")
    assert refused.status_code == 400

    created = employee_b.post("/api/stock/transfers/", {"from_depot": str(central.pk), "to_depot": str(bmag.pk),
                                                         "lines": line}, format="json")
    assert created.status_code == 201, created.json()
    validated = employee_b.post(f"/api/stock/transfers/{created.json()['id']}/validate/")
    assert validated.status_code == 200, validated.json()
    assert quantities(employee_b)["Cahier 200 pages"] == 3
    assert quantities(employee_b, "?library=central")["Cahier 200 pages"] == 0


def test_employee_cannot_adjust_another_library_stock(auth_client, libraries, stocked):
    _lib_a, lib_b, mag, *_ = libraries
    employee_b = auth_client(make_user("bamba", "MAGASINIER", library=lib_b))
    response = employee_b.post("/api/stock/movements/adjust/", {
        "article": str(stocked.pk), "depot": str(mag.pk), "kind": "LOSS", "quantity": -1, "reason": "Casse"},
        format="json")
    assert response.status_code == 400 and "depot" in response.json()


def test_library_price_replaces_catalog_price_for_that_library_only(libraries):
    lib_a, lib_b, *_ = libraries
    cahier = make_article("Cahier", retail=500)
    ArticleLibraryPrice.objects.create(article=cahier, library=lib_a, retail_price=550)
    now = timezone.now()
    assert catalog_unit_price(cahier, 1, now, lib_a) == (550, SaleLine.PriceKind.RETAIL)
    assert catalog_unit_price(cahier, 1, now, lib_b) == (500, SaleLine.PriceKind.RETAIL)
    assert catalog_unit_price(cahier, 1, now) == (500, SaleLine.PriceKind.RETAIL)


def test_only_own_library_prices_can_be_changed(auth_client, admin_user, manager_user, libraries):
    lib_a, lib_b, *_ = libraries
    cahier = make_article("Cahier", retail=500)
    manager_user.library = lib_a
    manager_user.save()
    manager = auth_client(manager_user)
    own = manager.post("/api/catalog/library-prices/", {"article": str(cahier.pk), "library": str(lib_a.pk),
                                                        "retail_price": 550}, format="json")
    assert own.status_code == 201, own.json()
    other = manager.post("/api/catalog/library-prices/", {"article": str(cahier.pk), "library": str(lib_b.pk),
                                                          "retail_price": 450}, format="json")
    assert other.status_code == 403
    # L'administrateur fixe le prix de n'importe quelle librairie.
    admin = auth_client(admin_user)
    response = admin.post("/api/catalog/library-prices/", {"article": str(cahier.pk), "library": str(lib_b.pk),
                                                           "retail_price": 450}, format="json")
    assert response.status_code == 201
    # Un caissier n'a pas la permission par défaut.
    cashier = auth_client(make_user("awa", "CAISSIER", library=lib_a))
    response = cashier.patch(f"/api/catalog/library-prices/{own.json()['id']}/", {"retail_price": 600},
                             format="json")
    assert response.status_code == 403


def test_reports_are_limited_to_the_employee_library(libraries):
    lib_a, lib_b, mag, bmag, _central = libraries
    period = reports.Period.from_params({"depot": str(mag.pk)}, library=lib_b)
    assert period.depot is None and period.library == lib_b
    assert period.as_dict()["depot_name"] == "Librairie B"
    assert reports.Period.from_params({}).as_dict()["depot_name"] == "Toutes les librairies"


def test_library_receipt_details_reach_the_terminals(auth_client, admin_user, libraries):
    lib_a = libraries[0]
    client = auth_client(admin_user)
    response = client.patch(f"/api/stock/libraries/{lib_a.pk}/",
                            {"address": "Rue du Commerce", "city": "Ferkessédougou", "phone": "0700000000",
                             "receipt_footer": "Merci, à bientôt à Ferké !"}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["city"] == "Ferkessédougou"

    rows = client.get("/api/sync/pull/?entities=libraries").json()["changes"]["libraries"]
    row = next(r for r in rows if r["id"] == str(lib_a.pk))
    assert row["address"] == "Rue du Commerce"
    assert row["receipt_footer"] == "Merci, à bientôt à Ferké !"
    assert row["receipt_name"] == ""  # vide : le terminal reprend le nom des paramètres
