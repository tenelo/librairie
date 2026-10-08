import uuid
from decimal import Decimal

import pytest

from apps.accounts.models import Device
from apps.audit.models import AuditLog
from apps.catalog.models import Kit
from apps.catalog.tests.factories import make_article, make_kit
from apps.customers.models import Customer
from apps.sales.models import CashSession, CreditNote, Sale, SaleReturn, Voucher
from apps.sales.services import customer_balance, loyalty_balance
from apps.stock.models import Depot, StockMovement
from apps.stock.services import on_hand, record_movement
from conftest import make_user

pytestmark = pytest.mark.django_db
TS = "2026-10-08T10:00:00Z"


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def till(db):
    return Device.objects.create(code="C01", name="Caisse 1")


@pytest.fixture
def till2(db):
    return Device.objects.create(code="C02", name="Caisse 2")


def push(client, ops, device="C01", ts=TS):
    response = client.post("/api/sync/push/", {"operations": [
        {"id": str(uuid.uuid4()), "entity": e, "operation": o, "payload": p, "client_timestamp": ts} for e, o, p in ops
    ]}, format="json", HTTP_X_DEVICE_CODE=device)
    assert response.status_code == 200, response.content
    return response.json()["results"]


def open_session(client, mag, device="C01", opening=20000):
    session_id = str(uuid.uuid4())
    result = push(client, [("cash_session", "open", {"id": session_id, "depot": str(mag.pk),
                                                     "opening_float": opening})], device)
    assert result[0]["status"] == "ok", result
    return session_id


def sale_payload(mag, session, lines, payments, *, number="C01-20261008-0001", global_discount=0, customer=None,
                 points_value=0, **extra):
    computed = []
    for line in lines:
        total = line["quantity"] * line["unit_price"] - line.get("discount", 0)
        computed.append({"line_total": total, "discount": 0, **line})
    subtotal = sum(line["line_total"] for line in computed)
    total = subtotal - global_discount - points_value
    paid = sum(p["amount"] for p in payments)
    return {"id": str(uuid.uuid4()), "receipt_number": number, "depot": str(mag.pk), "cash_session": session,
            "customer": customer, "lines": computed, "subtotal": subtotal, "global_discount": global_discount,
            "total": total, "payments": payments, "change_due": paid - total, **extra}


def test_cash_sale_mixed_payment_virtual_kit_and_stock(auth_client, cashier_user, mag, till):
    cahier, stylo = make_article("Cahier", 400, 250), make_article("Stylo", 150, 80)
    kit = make_kit([(cahier, 6), (stylo, 4)], discount=Decimal("10"))  # (2400 + 600) x 0,9 = 2700
    record_movement(cahier, mag, StockMovement.Kind.PURCHASE, 50)
    record_movement(stylo, mag, StockMovement.Kind.PURCHASE, 50)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    payload = sale_payload(mag, session, [
        {"article": str(kit.article.pk), "quantity": 1, "unit_price": 2700},
        {"article": str(cahier.pk), "quantity": 2, "unit_price": 400},
    ], [{"method": "CASH", "amount": 2000}, {"method": "ORANGE_MONEY", "amount": 1500, "reference": "OM123"}])
    result = push(client, [("sale", "create", payload)])
    assert result[0]["status"] == "ok", result
    sale = Sale.objects.get(pk=payload["id"])
    assert sale.total == 3500 and sale.change_due == 0 and sale.device == till
    assert on_hand(cahier, mag) == 50 - 6 - 2 and on_hand(stylo, mag) == 46
    assert AuditLog.objects.filter(entity="Sale", action="CREATE").exists()


def test_sale_is_idempotent_and_receipt_numbers_unique(auth_client, cashier_user, mag, till):
    cahier = make_article("Cahier", 400)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    payload = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 1, "unit_price": 400}],
                           [{"method": "CASH", "amount": 500}])
    assert push(client, [("sale", "create", payload)])[0]["status"] == "ok"
    assert push(client, [("sale", "create", payload)])[0]["status"] == "ok"  # renvoi sous un autre id d'outbox
    assert Sale.objects.count() == 1 and on_hand(cahier, mag) == -1
    other = {**payload, "id": str(uuid.uuid4())}
    assert push(client, [("sale", "create", other)])[0]["status"] == "error"


def test_two_offline_tills_sell_the_same_article(auth_client, cashier_user, mag, till, till2):
    """Scénario d'acceptation : deux caisses hors ligne vendent le même article puis synchronisent."""
    stylo = make_article("Stylo", 150)
    record_movement(stylo, mag, StockMovement.Kind.PURCHASE, 5)
    client = auth_client(cashier_user)
    s1, s2 = open_session(client, mag, "C01"), open_session(client, mag, "C02")
    p1 = sale_payload(mag, s1, [{"article": str(stylo.pk), "quantity": 4, "unit_price": 150}],
                      [{"method": "CASH", "amount": 600}], number="C01-20261008-0001")
    p2 = sale_payload(mag, s2, [{"article": str(stylo.pk), "quantity": 3, "unit_price": 150}],
                      [{"method": "CASH", "amount": 450}], number="C02-20261008-0001")
    assert push(client, [("sale", "create", p2)], "C02")[0]["status"] == "ok"
    assert push(client, [("sale", "create", p1)], "C01")[0]["status"] == "ok"
    assert push(client, [("sale", "create", p1)], "C01")[0]["status"] == "ok"
    assert on_hand(stylo, mag) == 5 - 4 - 3  # aucune vente perdue ni doublée ; l'écart est visible
    assert Sale.objects.count() == 2


def test_server_rejects_inconsistent_amounts(auth_client, cashier_user, mag, till):
    cahier = make_article("Cahier", 400)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    base = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 2, "unit_price": 400}],
                        [{"method": "CASH", "amount": 800}])
    wrong_total = {**base, "id": str(uuid.uuid4()), "total": 700}
    wrong_line = {**base, "id": str(uuid.uuid4()), "lines": [{**base["lines"][0], "line_total": 100}]}
    short_payment = {**base, "id": str(uuid.uuid4()), "payments": [{"method": "CASH", "amount": 500}],
                     "change_due": -300}
    change_on_mobile = {**base, "id": str(uuid.uuid4()), "change_due": 200,
                        "payments": [{"method": "WAVE", "amount": 1000, "reference": "W1"}]}
    no_reference = {**base, "id": str(uuid.uuid4()), "payments": [{"method": "WAVE", "amount": 800}]}
    wrong_device = {**base, "id": str(uuid.uuid4()), "receipt_number": "C09-20261008-0001"}
    results = push(client, [("sale", "create", p) for p in
                            (wrong_total, wrong_line, short_payment, change_on_mobile, no_reference, wrong_device)])
    assert [r["status"] for r in results] == ["error"] * 6
    assert not Sale.objects.exists()


def test_stale_catalog_price_accepted_when_valid_at_sale_time(auth_client, cashier_user, manager_user, mag, till):
    cahier = make_article("Cahier", 400)
    auth_client(manager_user).patch(f"/api/catalog/articles/{cahier.pk}/", {"retail_price": 450}, format="json")
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    # Vente hors ligne datée d'avant le changement de prix : 400 était le prix en vigueur.
    payload = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 1, "unit_price": 400}],
                           [{"method": "CASH", "amount": 400}])
    assert push(client, [("sale", "create", payload)], ts="2020-01-01T08:00:00Z")[0]["status"] == "ok"
    assert not AuditLog.objects.filter(entity="Sale", action="PRICE_CHANGE").exists()
    # Prix inventé : accepté (la vente a eu lieu) mais signalé.
    odd = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 1, "unit_price": 50}],
                       [{"method": "CASH", "amount": 50}], number="C01-20261008-0002")
    assert push(client, [("sale", "create", odd)])[0]["status"] == "ok"
    assert AuditLog.objects.filter(entity="Sale", action="PRICE_CHANGE").count() == 1


def test_wholesale_price_above_threshold(auth_client, cashier_user, mag, till):
    rame = make_article("Rame A4", 3500, wholesale_price=3200, wholesale_min_qty=10)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    payload = sale_payload(mag, session, [{"article": str(rame.pk), "quantity": 10, "unit_price": 3200}],
                           [{"method": "CASH", "amount": 32000}])
    push(client, [("sale", "create", payload)])
    line = Sale.objects.get().lines.get()
    assert line.price_kind == "WHOLESALE"
    assert not AuditLog.objects.filter(action="PRICE_CHANGE").exists()


def test_discount_cap_requires_manager_authorization(auth_client, cashier_user, manager_user, mag, till):
    cahier = make_article("Cahier", 1000)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    lines = [{"article": str(cahier.pk), "quantity": 1, "unit_price": 1000}]
    over = sale_payload(mag, session, lines, [{"method": "CASH", "amount": 800}], global_discount=200)
    assert push(client, [("sale", "create", over)])[0]["status"] == "error"  # 20 % > 5 % du caissier
    authorized = {**over, "id": str(uuid.uuid4()), "discount_authorized_by": "gerant"}
    assert push(client, [("sale", "create", authorized)])[0]["status"] == "ok"
    assert AuditLog.objects.filter(action="DISCOUNT_OVERRIDE").exists()
    small = sale_payload(mag, session, lines, [{"method": "CASH", "amount": 950}], global_discount=50,
                         number="C01-20261008-0002")
    assert push(client, [("sale", "create", small)])[0]["status"] == "ok"


def test_kit_substitution_at_sale(auth_client, cashier_user, mag, till):
    compas, luxe, cahier = make_article("Compas", 1500), make_article("Compas métal", 2500), make_article("Cahier", 400)
    kit = make_kit([(cahier, 2), (compas, 1)])
    component = kit.components.get(article=compas)
    component.substitutes.add(luxe)
    record_movement(luxe, mag, StockMovement.Kind.PURCHASE, 3)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    payload = sale_payload(mag, session, [{"article": str(kit.article.pk), "quantity": 1, "unit_price": 3300,
                                           "kit_adjustments": {"substitutions": {str(component.pk): str(luxe.pk)}}}],
                           [{"method": "CASH", "amount": 3300}])
    assert push(client, [("sale", "create", payload)])[0]["status"] == "ok"
    assert on_hand(luxe, mag) == 2 and on_hand(compas, mag) == 0 and on_hand(cahier, mag) == -2
    assert Sale.objects.get().lines.get().kit_adjustments[0]["action"] == "SUBSTITUTED"
    assert not AuditLog.objects.filter(action="PRICE_CHANGE").exists()


def test_credit_voucher_and_loyalty(auth_client, cashier_user, mag, till):
    cahier = make_article("Cahier", 2500)
    customer = Customer.objects.create(name="Koffi", phone="0708091011", credit_limit=10000)
    voucher = Voucher.objects.create(code="BA-1", amount=1000, remaining=1000)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    payload = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 2, "unit_price": 2500}],
                           [{"method": "CREDIT", "amount": 4000},
                            {"method": "VOUCHER", "amount": 1000, "voucher_code": "BA-1"}],
                           customer=str(customer.pk))
    assert push(client, [("sale", "create", payload)])[0]["status"] == "ok"
    voucher.refresh_from_db()
    assert voucher.remaining == 0 and customer_balance(customer) == 4000 and loyalty_balance(customer) == 5
    reuse = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 1, "unit_price": 2500}],
                         [{"method": "VOUCHER", "amount": 2500, "voucher_code": "BA-1"}], number="C01-20261008-0002")
    assert push(client, [("sale", "create", reuse)])[0]["status"] == "error"
    # 5 points x 10 FCFA convertis en remise
    redeem = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 1, "unit_price": 2500}],
                          [{"method": "CASH", "amount": 2450}], number="C01-20261008-0003",
                          customer=str(customer.pk), loyalty_points_used=5, points_value=50)
    assert push(client, [("sale", "create", redeem)])[0]["status"] == "ok"
    assert loyalty_balance(customer) == 2
    repay = push(client, [("customer_account", "repay", {"id": str(uuid.uuid4()), "customer": str(customer.pk),
                                                         "amount": 1500, "method": "CASH", "cash_session": session})])
    assert repay[0]["status"] == "ok" and customer_balance(customer) == 2500


def test_return_requires_authorization_and_creates_credit_note(auth_client, cashier_user, manager_user, mag, till):
    cahier = make_article("Cahier", 400)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    payload = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 5, "unit_price": 400}],
                           [{"method": "CASH", "amount": 1800}], global_discount=200,
                           discount_authorized_by="gerant")
    created = push(client, [("sale", "create", payload)])
    assert created[0]["status"] == "ok", created
    line = Sale.objects.get().lines.get()
    base = {"sale": payload["id"], "lines": [{"sale_line": str(line.pk), "quantity": 2}], "reason": "Doublon",
            "refund_mode": "CREDIT_NOTE"}
    assert push(client, [("sale_return", "create", {**base, "id": str(uuid.uuid4())})])[0]["status"] == "error"
    ok = push(client, [("sale_return", "create", {**base, "id": str(uuid.uuid4()), "authorized_by": "gerant"})])
    assert ok[0]["status"] == "ok", ok
    assert SaleReturn.objects.get().total == 720  # 2 x 400 x (1800 / 2000)
    assert CreditNote.objects.get().remaining == 720
    assert on_hand(cahier, mag) == -5 + 2
    too_many = {**base, "id": str(uuid.uuid4()), "authorized_by": "gerant",
                "lines": [{"sale_line": str(line.pk), "quantity": 4}]}
    assert push(client, [("sale_return", "create", too_many)])[0]["status"] == "error"
    assert AuditLog.objects.filter(action="REFUND").count() == 1


def test_cash_session_close_and_z_report(auth_client, cashier_user, mag, till):
    cahier = make_article("Cahier", 400)
    client = auth_client(cashier_user)
    session = open_session(client, mag, opening=20000)
    push(client, [("sale", "create", sale_payload(mag, session, [
        {"article": str(cahier.pk), "quantity": 3, "unit_price": 400}], [{"method": "CASH", "amount": 2000}]))])
    push(client, [("sale", "create", sale_payload(mag, session, [
        {"article": str(cahier.pk), "quantity": 1, "unit_price": 400}],
        [{"method": "MTN_MOMO", "amount": 400, "reference": "MM9"}], number="C01-20261008-0002"))])
    push(client, [("cash_session", "movement", {"id": str(uuid.uuid4()), "session": session, "kind": "OUT",
                                                "amount": 1000, "reason": "Achat de scotch"})])
    # attendu : 20 000 + 2 000 - 800 (monnaie) - 1 000 = 20 200 ; compté 20 150, soit un écart de -50
    denominations = {"10000": 2, "100": 1, "50": 1}
    closed = push(client, [("cash_session", "close", {"session": session, "counted_cash": 20150,
                                                      "denominations": denominations, "z_number": "Z-C01-0001"})])
    assert closed[0]["status"] == "ok", closed
    assert closed[0]["result"]["expected_cash"] == 20200 and closed[0]["result"]["variance"] == -50
    report = client.get(f"/api/sales/sessions/{session}/z-report/").json()
    assert report["sales_count"] == 2 and report["sales_total"] == 1600
    assert report["payments"]["CASH"]["total"] == 2000 and report["payments"]["MTN_MOMO"]["total"] == 400
    assert report["first_receipt"] == "C01-20261008-0001"
    late = sale_payload(mag, session, [{"article": str(cahier.pk), "quantity": 1, "unit_price": 400}],
                        [{"method": "CASH", "amount": 400}], number="C01-20261008-0003")
    assert push(client, [("sale", "create", late)], ts="2099-01-01T00:00:00Z")[0]["status"] == "error"


def test_single_open_session_per_till(auth_client, cashier_user, mag, till):
    client = auth_client(cashier_user)
    open_session(client, mag)
    second = push(client, [("cash_session", "open", {"id": str(uuid.uuid4()), "depot": str(mag.pk),
                                                     "opening_float": 0})])
    assert second[0]["status"] == "error"
    assert CashSession.objects.count() == 1


def test_offline_customer_creation_and_lww_update(auth_client, cashier_user, till):
    client = auth_client(cashier_user)
    customer_id = str(uuid.uuid4())
    created = push(client, [("customer", "create", {"id": customer_id, "name": "Aya", "phone": "0102030405"})])
    assert created[0]["status"] == "ok"
    version = created[0]["result"]["sync_version"]
    update = push(client, [("customer", "update", {"id": customer_id, "base_version": version,
                                                   "changes": {"phone": "0506070809", "credit_limit": 999}})])
    assert update[0]["status"] == "ok"
    assert Customer.objects.get(pk=customer_id).phone == "0506070809"


def test_sales_history_and_lookup_by_receipt(auth_client, cashier_user, mag, till):
    cahier = make_article("Cahier", 400)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    push(client, [("sale", "create", sale_payload(mag, session, [
        {"article": str(cahier.pk), "quantity": 1, "unit_price": 400}], [{"method": "CASH", "amount": 400}]))])
    found = client.get("/api/sales/sales/by-number/?number=C01-20261008-0001").json()
    assert found["total"] == 400 and found["lines"][0]["returnable"] == 1
    push(client, [("sale", "reprint", {"sale": found["id"]})])
    assert Sale.objects.get().reprint_count == 1
    assert AuditLog.objects.filter(action="REPRINT").exists()
    assert auth_client(make_user("preparateur", "PREPARATEUR")).get("/api/sales/sales/").status_code == 403


def test_kit_assembled_sale_uses_kit_stock(auth_client, cashier_user, mag, till):
    cahier = make_article("Cahier", 400)
    kit = make_kit([(cahier, 2)], stock_mode=Kit.StockMode.ASSEMBLED)
    record_movement(kit.article, mag, StockMovement.Kind.ASSEMBLY_IN, 4)
    client = auth_client(cashier_user)
    session = open_session(client, mag)
    push(client, [("sale", "create", sale_payload(mag, session, [
        {"article": str(kit.article.pk), "quantity": 1, "unit_price": 800}], [{"method": "CASH", "amount": 800}]))])
    assert on_hand(kit.article, mag) == 3 and on_hand(cahier, mag) == 0
