import pytest

from apps.audit.models import AuditLog
from apps.catalog.models import Kit
from apps.catalog.tests.factories import make_article, make_kit
from apps.stock.models import Depot, StockMovement
from apps.stock.services import on_hand, record_movement
from conftest import make_user

pytestmark = pytest.mark.django_db
Kind = StockMovement.Kind


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def res():
    return Depot.objects.get(code="RES")


@pytest.fixture
def storekeeper(db):
    return make_user("magasinier", "MAGASINIER")


def test_stock_state_with_status_and_value(auth_client, cashier_user, mag, res):
    cahier = make_article("Cahier", cost=250, alert_threshold=10)
    stylo = make_article("Stylo", cost=80, alert_threshold=5)
    make_article("Gomme")
    make_article("Photocopie", type_="SERVICE")
    make_kit([(cahier, 2)])  # kit virtuel : absent de l'état des stocks
    record_movement(cahier, mag, Kind.PURCHASE, 8)
    record_movement(cahier, res, Kind.PURCHASE, 30)
    record_movement(stylo, mag, Kind.PURCHASE, 3)
    client = auth_client(cashier_user)

    rows = {r["name"]: r for r in client.get("/api/stock/state/").json()["results"]}
    assert set(rows) == {"Cahier", "Stylo", "Gomme"}
    assert rows["Cahier"]["quantity"] == 38 and rows["Cahier"]["status"] == "OK"
    assert rows["Cahier"]["value"] == 38 * 250
    assert rows["Stylo"]["status"] == "LOW" and rows["Gomme"]["status"] == "OUT"

    in_mag = {r["name"]: r for r in client.get(f"/api/stock/state/?depot={mag.pk}").json()["results"]}
    assert in_mag["Cahier"]["quantity"] == 8 and in_mag["Cahier"]["status"] == "LOW"
    out = client.get("/api/stock/state/?status=OUT").json()["results"]
    assert [r["name"] for r in out] == ["Gomme"]


def test_movements_are_read_only_and_card_has_balance(auth_client, cashier_user, mag):
    cahier = make_article("Cahier")
    record_movement(cahier, mag, Kind.PURCHASE, 10)
    record_movement(cahier, mag, Kind.SALE, -2)
    client = auth_client(cashier_user)
    assert client.get("/api/stock/movements/").json()["count"] == 2
    assert client.post("/api/stock/movements/", {}, format="json").status_code == 405
    card = client.get(f"/api/stock/movements/card/?article={cahier.pk}").json()
    assert [line["balance"] for line in card] == [8, 10]  # plus récent en premier


def test_loss_requires_permission_and_is_audited(auth_client, cashier_user, storekeeper, mag):
    cahier = make_article("Cahier")
    record_movement(cahier, mag, Kind.PURCHASE, 10)
    payload = {"article": str(cahier.pk), "depot": str(mag.pk), "kind": "LOSS", "quantity": 3,
               "reason": "Cahiers mouillés"}
    assert auth_client(cashier_user).post("/api/stock/movements/adjust/", payload,
                                          format="json").status_code == 403
    response = auth_client(storekeeper).post("/api/stock/movements/adjust/", payload, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["quantity"] == -3
    assert on_hand(cahier, mag) == 7
    assert AuditLog.objects.filter(entity="StockMovement", description__contains="Cahiers mouillés").exists()
    too_much = {**payload, "quantity": 50}
    assert auth_client(storekeeper).post("/api/stock/movements/adjust/", too_much, format="json").status_code == 400


def test_transfer_workflow(auth_client, storekeeper, mag, res):
    cahier = make_article("Cahier")
    record_movement(cahier, res, Kind.PURCHASE, 20)
    client = auth_client(storekeeper)
    created = client.post("/api/stock/transfers/", {"from_depot": str(res.pk), "to_depot": str(mag.pk),
                                                    "lines": [{"article": str(cahier.pk), "quantity": 15}]},
                          format="json")
    assert created.status_code == 201, created.content
    transfer = created.json()
    assert transfer["number"].startswith("TR-") and transfer["status"] == "DRAFT"
    validated = client.post(f"/api/stock/transfers/{transfer['id']}/validate/")
    assert validated.status_code == 200 and validated.json()["status"] == "VALIDATED"
    assert on_hand(cahier, mag) == 15
    edit = client.patch(f"/api/stock/transfers/{transfer['id']}/", {"note": "x"}, format="json")
    assert edit.status_code == 400
    same = client.post("/api/stock/transfers/", {"from_depot": str(mag.pk), "to_depot": str(mag.pk),
                                                 "lines": [{"article": str(cahier.pk), "quantity": 1}]},
                       format="json")
    assert same.status_code == 400


def test_kit_assembly_endpoint(auth_client, storekeeper, mag):
    cahier = make_article("Cahier")
    kit = make_kit([(cahier, 6)], stock_mode=Kit.StockMode.ASSEMBLED)
    record_movement(cahier, mag, Kind.PURCHASE, 30)
    response = auth_client(storekeeper).post("/api/stock/assemblies/", {
        "kit": str(kit.pk), "depot": str(mag.pk), "operation": "ASSEMBLE", "quantity": 5}, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["kit_name"] == kit.article.name
    assert on_hand(kit.article, mag) == 5 and on_hand(cahier, mag) == 0
    refused = auth_client(storekeeper).post("/api/stock/assemblies/", {
        "kit": str(kit.pk), "depot": str(mag.pk), "operation": "ASSEMBLE", "quantity": 1}, format="json")
    assert refused.status_code == 400


def test_depots_managed_by_admin_only(auth_client, admin_user, storekeeper, mag):
    assert len(auth_client(storekeeper).get("/api/stock/depots/").json()) == 2
    assert auth_client(storekeeper).post("/api/stock/depots/", {"code": "ANX", "name": "Annexe"},
                                         format="json").status_code == 403
    created = auth_client(admin_user).post("/api/stock/depots/", {"code": "anx", "name": "Annexe",
                                                                   "is_default": True}, format="json")
    assert created.status_code == 201 and created.json()["code"] == "ANX"
    mag.refresh_from_db()
    assert not mag.is_default
    record_movement(make_article("Cahier"), mag, Kind.PURCHASE, 1)
    assert auth_client(admin_user).delete(f"/api/stock/depots/{mag.pk}/").status_code == 400


def test_alerts_and_summary(auth_client, storekeeper, mag):
    cahier = make_article("Cahier", cost=100, alert_threshold=10)
    from apps.stock.services import refresh_alerts

    record_movement(cahier, mag, Kind.PURCHASE, 4)
    refresh_alerts([cahier])
    client = auth_client(storekeeper)
    alerts = client.get("/api/stock/alerts/").json()["results"]
    assert [(a["article_name"], a["kind"]) for a in alerts] == [("Cahier", "LOW")]
    make_article("Gomme", alert_threshold=2)  # jamais mouvementée : rupture
    summary = client.get("/api/stock/summary/").json()
    assert summary == {"valuation": 400, "low": 1, "out": 1}
    assert client.post("/api/stock/alerts/refresh/").json() == {"open": 2}
    kinds = sorted(a["kind"] for a in client.get("/api/stock/alerts/").json()["results"])
    assert kinds == ["LOW", "OUT"]


def test_device_can_be_attached_to_depot(auth_client, admin_user, mag):
    response = auth_client(admin_user).post("/api/accounts/devices/", {"code": "C01", "name": "Caisse 1",
                                                                       "depot": str(mag.pk)}, format="json")
    assert response.status_code == 201 and response.json()["depot_code"] == "MAG"
