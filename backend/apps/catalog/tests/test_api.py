import pytest

from apps.audit.models import AuditLog
from apps.catalog.models import Article, Barcode, Category, Kit, KitComponent, PriceHistory, SchoolLevel
from apps.customers.models import School
from conftest import make_user

from .factories import make_article, make_kit

pytestmark = pytest.mark.django_db


@pytest.fixture
def magasinier(db):
    return make_user("magasin", "MAGASINIER")


def test_cashier_reads_catalog_but_cannot_write(auth_client, cashier_user):
    make_article("Cahier 100 pages")
    client = auth_client(cashier_user)
    assert client.get("/api/catalog/articles/").json()["count"] == 1
    response = client.post("/api/catalog/articles/", {"name": "Stylo"}, format="json")
    assert response.status_code == 403


def test_client_has_no_catalog_access_in_backoffice(auth_client, client_user):
    assert auth_client(client_user).get("/api/catalog/articles/").status_code == 403


def test_manager_creates_article_with_generated_code_and_barcode(auth_client, manager_user):
    category = Category.objects.get(name="Cahiers", parent=None)
    response = auth_client(manager_user).post("/api/catalog/articles/", {
        "name": "Cahier 200 pages", "category": str(category.pk), "retail_price": 800, "avg_cost": 500,
        "wholesale_price": 700, "wholesale_min_qty": 10, "alert_threshold": 20,
    }, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["code"].startswith("ART-")
    assert len(body["barcodes"]) == 1 and body["barcodes"][0]["kind"] == "INTERNAL"
    assert body["category_path"] == "Cahiers"
    assert body["margin"] == 300
    assert AuditLog.objects.filter(action=AuditLog.Action.CREATE, entity="Article").exists()


def test_manufacturer_ean_is_validated_and_unique(auth_client, manager_user):
    client = auth_client(manager_user)
    bad = client.post("/api/catalog/articles/", {"name": "Stylo", "barcodes": [{"code": "4006381333932"}]},
                      format="json")
    assert bad.status_code == 400
    ok = client.post("/api/catalog/articles/", {"name": "Stylo", "barcodes": [{"code": "4006381333931"}]},
                     format="json")
    assert ok.status_code == 201
    assert len(ok.json()["barcodes"]) == 1
    duplicate = client.post("/api/catalog/articles/", {"name": "Autre", "barcodes": [{"code": "4006381333931"}]},
                            format="json")
    assert duplicate.status_code == 400
    assert "Stylo" in str(duplicate.json())


def test_lookup_by_barcode_and_search(auth_client, cashier_user):
    article = make_article("Stylo bleu")
    Barcode.objects.create(article=article, code="4006381333931")
    client = auth_client(cashier_user)
    assert client.get("/api/catalog/articles/by-barcode/?code=4006381333931").json()["id"] == str(article.pk)
    assert client.get(f"/api/catalog/articles/by-barcode/?code={article.code}").status_code == 200
    assert client.get("/api/catalog/articles/by-barcode/?code=000").status_code == 404
    assert client.get("/api/catalog/articles/?search=4006381333931").json()["count"] == 1
    assert len(client.get("/api/catalog/articles/lookup/?search=stylo").json()) == 1


def test_category_filter_includes_subcategories(auth_client, cashier_user):
    root = Category.objects.get(name="Cahiers", parent=None)
    child = Category.objects.create(name="Grands cahiers", parent=root)
    make_article("Cahier 200 pages", category=child)
    make_article("Stylo", category=Category.objects.get(name="Écriture"))
    response = auth_client(cashier_user).get(f"/api/catalog/articles/?category={root.pk}")
    assert [a["name"] for a in response.json()["results"]] == ["Cahier 200 pages"]


def test_price_change_requires_permission_and_is_traced(auth_client, manager_user):
    article = make_article("Cahier", retail=400)
    kit = make_kit([(article, 3)])
    from apps.accounts.models import Permission, Role

    # Un rôle qui gère le catalogue sans pouvoir modifier les prix.
    role = Role.objects.get(code="MAGASINIER")
    role.permissions.add(Permission.objects.get(code="catalog.manage"))
    editor = make_user("editeur", "MAGASINIER")
    denied = auth_client(editor).patch(f"/api/catalog/articles/{article.pk}/", {"retail_price": 450}, format="json")
    assert denied.status_code == 403
    assert auth_client(editor).patch(f"/api/catalog/articles/{article.pk}/", {"name": "Cahier 96p"},
                                     format="json").status_code == 200

    ok = auth_client(manager_user).patch(f"/api/catalog/articles/{article.pk}/", {"retail_price": 450},
                                         format="json")
    assert ok.status_code == 200
    assert PriceHistory.objects.filter(article=article, field="retail_price", old_value="400",
                                       new_value="450").exists()
    log = AuditLog.objects.get(action=AuditLog.Action.PRICE_CHANGE, entity="Article")
    assert log.old_values == {"retail_price": "400"} and log.new_values == {"retail_price": "450"}
    kit.article.refresh_from_db()
    assert kit.article.retail_price == 1350


def test_avg_cost_is_read_only_after_creation(auth_client, manager_user):
    article = make_article("Cahier", cost=250)
    response = auth_client(manager_user).patch(f"/api/catalog/articles/{article.pk}/", {"avg_cost": 10},
                                               format="json")
    assert response.status_code == 400


def test_type_rules(auth_client, manager_user):
    client = auth_client(manager_user)
    article = make_article("Stylo")
    assert client.patch(f"/api/catalog/articles/{article.pk}/", {"type": "SERVICE"},
                        format="json").status_code == 400
    assert client.post("/api/catalog/articles/", {"name": "Kit", "type": "KIT"}, format="json").status_code == 400
    lot = client.post("/api/catalog/articles/", {"name": "Paquet de 10", "type": "LOT"}, format="json")
    assert lot.status_code == 400
    lot = client.post("/api/catalog/articles/", {"name": "Paquet de 10", "type": "LOT",
                                                 "lot_base_article": str(article.pk), "lot_units": 10},
                      format="json")
    assert lot.status_code == 201, lot.content


def test_article_in_kit_cannot_be_deleted(auth_client, manager_user):
    article = make_article("Cahier")
    make_kit([(article, 2)])
    client = auth_client(manager_user)
    assert client.delete(f"/api/catalog/articles/{article.pk}/").status_code == 400
    lonely = make_article("Gomme")
    assert client.delete(f"/api/catalog/articles/{lonely.pk}/").status_code == 204
    assert Article.all_objects.get(pk=lonely.pk).is_deleted


def test_kit_crud_through_api(auth_client, manager_user):
    cahier, stylo, compas, compas_luxe = (make_article("Cahier", 400, 250), make_article("Stylo", 150, 80),
                                          make_article("Compas", 1500, 1000), make_article("Compas métal", 2500))
    school = School.objects.create(name="Lycée Moderne de Cocody", city="Abidjan")
    level = SchoolLevel.objects.get(code="6EME")
    client = auth_client(manager_user)
    payload = {
        "name": "Kit 6ème — LMC", "level": str(level.pk), "school": str(school.pk), "discount_percent": "10",
        "components": [
            {"article": str(cahier.pk), "quantity": 6},
            {"article": str(stylo.pk), "quantity": 4, "is_optional": True},
            {"article": str(compas.pk), "quantity": 1, "substitutes": [str(compas_luxe.pk)]},
        ],
    }
    response = client.post("/api/catalog/kits/", payload, format="json")
    assert response.status_code == 201, response.content
    kit = response.json()
    # (2400 + 600 + 1500) × 0,9 = 4050
    assert kit["pricing"]["price"] == 4050 and kit["retail_price"] == 4050
    assert kit["code"].startswith("KIT-") and len(kit["barcodes"]) == 1
    assert kit["school_name"] == "Lycée Moderne de Cocody"

    compas_component = next(c for c in kit["components"] if c["article"] == str(compas.pk))
    preview = client.post(f"/api/catalog/kits/{kit['id']}/customize/",
                          {"substitutions": {compas_component["id"]: str(compas_luxe.pk)}}, format="json")
    assert preview.json()["price"] == 4050 + 900

    payload["components"] = [{"article": str(cahier.pk), "quantity": 8}]
    updated = client.put(f"/api/catalog/kits/{kit['id']}/", payload, format="json")
    assert updated.status_code == 200, updated.content
    assert updated.json()["pricing"]["price"] == 2880
    assert KitComponent.objects.filter(kit_id=kit["id"]).count() == 1
    assert KitComponent.all_objects.filter(kit_id=kit["id"], is_deleted=True).count() == 2

    assert client.get(f"/api/catalog/kits/?school={school.pk}").json()["count"] == 1
    assert client.delete(f"/api/catalog/kits/{kit['id']}/").status_code == 204
    assert Article.all_objects.get(pk=kit["article_id"]).is_deleted


def test_kit_validation(auth_client, manager_user):
    cahier = make_article("Cahier")
    other_kit = make_kit([(cahier, 1)])
    level = SchoolLevel.objects.get(code="CP1")
    client = auth_client(manager_user)
    empty = client.post("/api/catalog/kits/", {"name": "Vide", "level": str(level.pk), "components": []},
                        format="json")
    assert empty.status_code == 400
    nested = client.post("/api/catalog/kits/", {"name": "Imbriqué", "level": str(level.pk), "components": [
        {"article": str(other_kit.article.pk), "quantity": 1}]}, format="json")
    assert nested.status_code == 400
    duplicates = client.post("/api/catalog/kits/", {"name": "Doublon", "level": str(level.pk), "components": [
        {"article": str(cahier.pk), "quantity": 1}, {"article": str(cahier.pk), "quantity": 2}]}, format="json")
    assert duplicates.status_code == 400


def test_duplicate_kit_endpoint(auth_client, manager_user):
    kit = make_kit([(make_article("Cahier"), 6)])
    year_level = SchoolLevel.objects.get(code="5EME")
    response = auth_client(manager_user).post(f"/api/catalog/kits/{kit.pk}/duplicate/",
                                              {"name": "Kit 5ème", "level": str(year_level.pk)}, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["level_label"] == "5ème"
    assert Kit.objects.count() == 2


def test_school_year_single_current(auth_client, manager_user):
    client = auth_client(manager_user)
    response = client.post("/api/catalog/school-years/", {"label": "2027-2028", "starts_on": "2027-09-01",
                                                          "ends_on": "2028-07-31", "is_current": True}, format="json")
    assert response.status_code == 201
    years = client.get("/api/catalog/school-years/").json()
    assert [y["label"] for y in years if y["is_current"]] == ["2027-2028"]


def test_levels_seeded_in_order(auth_client, cashier_user):
    levels = auth_client(cashier_user).get("/api/catalog/levels/").json()
    codes = [level["code"] for level in levels]
    assert codes[:2] == ["CP1", "CP2"] and codes[-1] == "TLE-D" and "6EME" in codes


def test_schools_crud(auth_client, manager_user, cashier_user):
    created = auth_client(manager_user).post("/api/customers/schools/", {"name": "Collège Saint-Viateur",
                                                                         "city": "Abidjan"}, format="json")
    assert created.status_code == 201
    duplicate = auth_client(manager_user).post("/api/customers/schools/", {"name": "collège saint-viateur",
                                                                           "city": "Abidjan"}, format="json")
    assert duplicate.status_code == 400
    assert auth_client(cashier_user).get("/api/customers/schools/").json()["count"] == 1


def test_category_tree_rules(auth_client, manager_user):
    client = auth_client(manager_user)
    root = Category.objects.get(name="Cahiers", parent=None)
    child = client.post("/api/catalog/categories/", {"name": "Petits cahiers", "parent": str(root.pk)},
                        format="json").json()
    cycle = client.patch(f"/api/catalog/categories/{root.pk}/", {"parent": child["id"]}, format="json")
    assert cycle.status_code == 400
    assert client.delete(f"/api/catalog/categories/{root.pk}/").status_code == 400
    assert client.delete(f"/api/catalog/categories/{child['id']}/").status_code == 204
