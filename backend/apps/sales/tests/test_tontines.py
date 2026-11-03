"""Tontine scolaire : souscription, versements en caisse, remise des fournitures et annulation."""
import pytest

from apps.catalog.tests.factories import make_article
from apps.sales.models import CashSession, Sale, Tontine
from apps.sales.services import expected_cash
from apps.stock.models import Depot, Library, StockMovement
from apps.stock.services import on_hand, record_movement
from conftest import make_user

from .test_sales import open_session, push, sale_payload

pytestmark = pytest.mark.django_db
URL = "/api/sales/tontines/"


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def till(db):
    from apps.accounts.models import Device

    return Device.objects.create(code="C01", name="Caisse 1")


@pytest.fixture
def supplies(mag):
    cahier, stylo = make_article("Cahier 200 pages", 500, 300), make_article("Stylo bleu", 150, 80)
    record_movement(cahier, mag, StockMovement.Kind.PURCHASE, 50)
    record_movement(stylo, mag, StockMovement.Kind.PURCHASE, 50)
    return cahier, stylo


def subscribe(client, lines, depot=None, name="Konan Awa", phone="07 07 07 07 07"):
    payload = {"subscriber_name": name, "subscriber_phone": phone,
               "lines": [{"article": str(a.pk), "quantity": q} for a, q in lines]}
    if depot is not None:
        payload["depot"] = str(depot.pk)
    response = client.post(URL, payload, format="json")
    assert response.status_code == 201, response.json()
    return response.json()


def pay(client, tontine_id, amount, session=None, method="CASH", **extra):
    return client.post(f"{URL}{tontine_id}/pay/", {"amount": amount, "method": method, "cash_session": session,
                                                    **extra}, format="json", HTTP_X_DEVICE_CODE="C01")


def test_subscription_freezes_prices_and_target(auth_client, cashier_user, supplies):
    cahier, stylo = supplies
    client = auth_client(cashier_user)
    tontine = subscribe(client, [(cahier, 10), (stylo, 10)])
    assert tontine["number"].startswith("TS-") and tontine["target_amount"] == 6500
    assert tontine["subscriber_name"] == "Konan Awa" and tontine["depot_name"] == "Magasin"
    assert tontine["remaining"] == 6500 and tontine["status"] == "OPEN"
    # Une hausse de prix ultérieure ne change pas le montant souscrit.
    cahier.retail_price = 600
    cahier.save()
    assert client.get(f"{URL}{tontine['id']}/").json()["target_amount"] == 6500


def test_subscription_needs_name_and_articles_and_name_can_change(auth_client, cashier_user, supplies):
    cahier, _stylo = supplies
    client = auth_client(cashier_user)
    assert client.post(URL, {"subscriber_name": "Awa", "lines": []}, format="json").status_code == 400
    assert client.post(URL, {"lines": [{"article": str(cahier.pk), "quantity": 1}]},
                       format="json").status_code == 400
    tontine = subscribe(client, [(cahier, 1)])
    response = client.patch(f"{URL}{tontine['id']}/", {"subscriber_name": "Konan Awa Marie",
                                                       "subscriber_phone": "05 05 05 05 05"}, format="json")
    assert response.status_code == 200, response.json()
    assert response.json()["subscriber_name"] == "Konan Awa Marie"
    assert client.get(URL, {"search": "Marie"}).json()["results"][0]["id"] == tontine["id"]


def test_payments_go_to_cash_drawer_and_cannot_exceed_remaining(auth_client, cashier_user, mag, supplies, till):
    cahier, _stylo = supplies
    client = auth_client(cashier_user)
    session = open_session(client, mag, opening=10000)
    tontine = subscribe(client, [(cahier, 10)])  # 5 000 FCFA
    # Espèces sans caisse ouverte : refusé.
    assert pay(client, tontine["id"], 1000).status_code == 400
    first = pay(client, tontine["id"], 2500, session)
    assert first.status_code == 201, first.json()
    assert first.json()["number"].endswith("-V01")
    assert pay(client, tontine["id"], 1000, method="WAVE", reference="WV-1").status_code == 201
    too_much = pay(client, tontine["id"], 2000, session)
    assert too_much.status_code == 400 and "1500" in str(too_much.json())
    detail = client.get(f"{URL}{tontine['id']}/").json()
    assert detail["paid_amount"] == 3500 and detail["remaining"] == 1500 and detail["progress"] == 70
    # Seules les espèces entrent dans le tiroir.
    assert expected_cash(CashSession.objects.get(pk=session)) == 12500


def test_delivery_at_till_imputes_payments_and_moves_stock(auth_client, cashier_user, mag, supplies, till):
    cahier, stylo = supplies
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    tontine = subscribe(client, [(cahier, 10), (stylo, 10)])
    pay(client, tontine["id"], 4000, session)
    cahier.retail_price = 600
    cahier.save()
    lines = [{"article": str(cahier.pk), "quantity": 10, "unit_price": 500},
             {"article": str(stylo.pk), "quantity": 10, "unit_price": 150}]

    # Le versement doit être entièrement imputé.
    wrong = sale_payload(mag, session, lines, [{"method": "TONTINE", "amount": 3000},
                                               {"method": "CASH", "amount": 3500}], tontine=tontine["id"])
    assert push(client, [("sale", "create", wrong)])[0]["status"] != "ok"

    payload = sale_payload(mag, session, lines, [{"method": "TONTINE", "amount": 4000},
                                                 {"method": "CASH", "amount": 2500}], tontine=tontine["id"],
                           number="C01-20261008-0002")
    result = push(client, [("sale", "create", payload)])
    assert result[0]["status"] == "ok", result
    sale = Sale.objects.get(pk=payload["id"])
    assert sale.total == 6500
    assert on_hand(cahier, mag) == 40
    done = Tontine.objects.get(pk=tontine["id"])
    assert done.status == Tontine.Status.DELIVERED and done.used_amount == 4000 and done.sale == sale
    # Une tontine remise ne reçoit plus de versement.
    assert pay(client, tontine["id"], 500, session).status_code == 400


def test_tontine_payment_method_only_for_its_delivery(auth_client, cashier_user, mag, supplies, till):
    cahier, _stylo = supplies
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    payload = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 1, "unit_price": 500}],
                           [{"method": "TONTINE", "amount": 500}])
    assert push(client, [("sale", "create", payload)])[0]["status"] != "ok"


def test_delivered_articles_must_match_subscription(auth_client, cashier_user, mag, supplies, till):
    cahier, stylo = supplies
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    tontine = subscribe(client, [(cahier, 2)])
    payload = sale_payload(mag, session, [{"article": str(stylo.pk), "quantity": 2, "unit_price": 150}],
                           [{"method": "CASH", "amount": 300}], tontine=tontine["id"])
    assert push(client, [("sale", "create", payload)])[0]["status"] != "ok"


def test_cancel_refunds_subscriber_and_needs_permission(auth_client, cashier_user, manager_user, mag, supplies,
                                                         till):
    cahier, _stylo = supplies
    cashier = auth_client(cashier_user)
    session = open_session(cashier, mag, opening=10000)
    tontine = subscribe(cashier, [(cahier, 16)])  # 8 000 FCFA
    pay(cashier, tontine["id"], 3000, session)
    body = {"reason": "Déménagement", "method": "CASH", "cash_session": session}
    assert cashier.post(f"{URL}{tontine['id']}/cancel/", body, format="json").status_code == 403
    manager = auth_client(manager_user)
    response = manager.post(f"{URL}{tontine['id']}/cancel/", body, format="json", HTTP_X_DEVICE_CODE="C01")
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "CANCELLED" and response.json()["paid_amount"] == 0
    assert expected_cash(CashSession.objects.get(pk=session)) == 10000


def test_employee_sees_only_own_library_tontines(auth_client, admin_user, mag, supplies):
    cahier, _stylo = supplies
    lib_a, lib_b = Library.objects.create(name="Librairie A"), Library.objects.create(name="Librairie B")
    mag.library = lib_a
    mag.save()
    bmag = Depot.objects.create(code="BMAG", name="Magasin B", library=lib_b)
    admin = auth_client(admin_user)
    subscribe(admin, [(cahier, 10)], depot=mag)
    subscribe(admin, [(cahier, 14)], depot=bmag)
    employee_b = auth_client(make_user("bamba", "CAISSIER", library=lib_b))
    rows = employee_b.get(URL).json()["results"]
    assert [r["target_amount"] for r in rows] == [7000]
    # Sans dépôt indiqué, la souscription va au dépôt de sa librairie.
    assert subscribe(employee_b, [(cahier, 1)])["depot_name"] == "Magasin B"
    # Pas de souscription sur le dépôt d'une autre librairie.
    response = employee_b.post(URL, {"subscriber_name": "X", "depot": str(mag.pk),
                                     "lines": [{"article": str(cahier.pk), "quantity": 1}]}, format="json")
    assert response.status_code == 400
    admin = auth_client(admin_user)
    assert len(admin.get(URL).json()["results"]) == 3


def test_summary_counts_subscribers_amounts_and_kits(auth_client, cashier_user, mag, supplies, till):
    from apps.catalog.tests.factories import make_kit

    cahier, stylo = supplies
    kit = make_kit([(cahier, 2), (stylo, 2)])
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    first = subscribe(client, [(kit.article, 2), (stylo, 1)])
    subscribe(client, [(kit.article, 1)], name="Tuo Alphonse", phone="0102030405")
    subscribe(client, [(cahier, 1)])  # même souscripteur, deuxième souscription
    pay(client, first["id"], 1000, session)
    summary = client.get(f"{URL}summary/", {"status": "OPEN"}).json()
    kit_price = kit.article.retail_price
    assert summary["subscribers_count"] == 2 and summary["subscriptions_count"] == 3
    assert summary["expected_total"] == 3 * kit_price + 150 + 500
    assert summary["received_total"] == 1000
    assert summary["kits"] == [{"label": kit.article.name, "quantity": 3}]


def test_designated_person_sees_all_libraries_but_manages_only_own(auth_client, admin_user, mag, supplies, till):
    from apps.accounts.models import Permission, Role

    cahier, _stylo = supplies
    lib_a, lib_b = Library.objects.create(name="Librairie A"), Library.objects.create(name="Librairie B")
    mag.library = lib_a
    mag.save()
    bmag = Depot.objects.create(code="BMAG", name="Magasin B", library=lib_b)
    admin = auth_client(admin_user)
    in_a = subscribe(admin, [(cahier, 10)], depot=mag)
    subscribe(admin, [(cahier, 14)], depot=bmag)
    role = Role.objects.get(code="CAISSIER")
    role.permissions.add(Permission.objects.get(code="tontines.view_all"))
    employee_b = auth_client(make_user("bamba", "CAISSIER", library=lib_b))
    assert len(employee_b.get(URL).json()["results"]) == 2
    assert employee_b.get(f"{URL}summary/").json()["expected_total"] == 12000
    # Consultation seulement pour la librairie A.
    assert pay(employee_b, in_a["id"], 1000, method="WAVE", reference="W1").status_code == 403


def test_school_year_filter_and_traceability(auth_client, cashier_user, manager_user, mag, supplies, till):
    from apps.catalog.models import SchoolYear

    cahier, _stylo = supplies
    current = SchoolYear.current()
    previous = SchoolYear.objects.create(label="2025-2026", starts_on="2025-09-01", ends_on="2026-07-31")
    cashier = auth_client(cashier_user)
    session = open_session(cashier, mag)
    this_year = subscribe(cashier, [(cahier, 10)])
    assert this_year["school_year"] == str(current.pk) and this_year["school_year_label"] == current.label
    response = cashier.post(URL, {"subscriber_name": "Ancien", "school_year": str(previous.pk),
                                  "lines": [{"article": str(cahier.pk), "quantity": 2}]}, format="json")
    assert response.status_code == 201
    rows = cashier.get(URL, {"school_year": str(previous.pk)}).json()["results"]
    assert [r["subscriber_name"] for r in rows] == ["Ancien"]
    assert cashier.get(f"{URL}summary/", {"school_year": str(current.pk)}).json()["expected_total"] == 5000

    pay(cashier, this_year["id"], 1000, session)
    cashier.patch(f"{URL}{this_year['id']}/", {"subscriber_name": "Konan Awa Marie"}, format="json")
    manager = auth_client(manager_user)
    cancelled = manager.post(f"{URL}{this_year['id']}/cancel/", {"reason": "Déménagement", "cash_session": session},
                             format="json", HTTP_X_DEVICE_CODE="C01").json()
    assert cancelled["cancel_reason"] == "Déménagement" and cancelled["cancelled_by_name"]
    history = manager.get(f"{URL}{this_year['id']}/history/").json()
    descriptions = " | ".join(h["description"] for h in history)
    assert "Konan Awa → Konan Awa Marie" in descriptions
    assert "Versement" in descriptions and "Annulation" in descriptions
    assert [h["action"] for h in history][0] == "Création"


def test_excel_export_lists_kits_articles_and_needs(auth_client, cashier_user, mag, supplies):
    from io import BytesIO

    from openpyxl import load_workbook

    from apps.catalog.tests.factories import make_kit

    cahier, stylo = supplies  # 50 cahiers, 50 stylos en stock
    kit = make_kit([(cahier, 20), (stylo, 5)], name="Kit CM1")
    client = auth_client(cashier_user)
    subscribe(client, [(kit.article, 2), (stylo, 3)])
    subscribe(client, [(kit.article, 1)], name="Tuo Alphonse")
    response = client.get(f"{URL}export/", {"status": "OPEN"})
    assert response.status_code == 200
    assert response["Content-Disposition"].startswith('attachment; filename="souscriptions-')
    workbook = load_workbook(BytesIO(response.content))
    assert workbook.sheetnames == ["TCD kits et articles", "Besoin en articles", "Lignes souscrites"]
    pivot = [row for row in workbook["TCD kits et articles"].iter_rows(values_only=True) if row and row[0]]
    kit_row = next(r for r in pivot if r[1] == "Kit CM1")
    assert kit_row[2] == 3 and kit_row[3] == 2
    stylo_row = next(r for r in pivot if r[1] == "Stylo bleu")
    assert stylo_row[2] == 3 and stylo_row[5] == 50
    needs = {r[1]: r for r in workbook["Besoin en articles"].iter_rows(min_row=3, values_only=True)}
    # 3 kits × 20 cahiers = 60 pour 50 en stock ; stylos : 3 directs + 15 dans les kits.
    assert needs["Cahier 200 pages"][2:4] == (0, 60) and needs["Cahier 200 pages"][5] == 50
    assert needs["Stylo bleu"][2:4] == (3, 15)
    assert workbook["Lignes souscrites"].max_row == 4
