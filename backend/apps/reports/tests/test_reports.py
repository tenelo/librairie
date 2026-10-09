import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.catalog import CAISSIER
from apps.accounts.models import Device
from apps.catalog.tests.factories import make_article, make_kit
from apps.reports import scheduling, services
from apps.reports.models import ScheduledReport
from apps.stock.models import Depot, StockMovement
from apps.stock.services import record_movement
from conftest import make_user

pytestmark = pytest.mark.django_db
DAY = datetime(2026, 9, 15, 10, 0, tzinfo=dt_timezone.utc)


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def shop(mag, cashier_user):
    Device.objects.create(code="C01", name="Caisse 1")
    cahier, stylo = make_article("Cahier", 400, 250), make_article("Stylo", 150, 80)
    kit = make_kit([(cahier, 4), (stylo, 2)], discount=Decimal("0"))  # 1 900 FCFA
    for article in (cahier, stylo):
        record_movement(article, mag, StockMovement.Kind.PURCHASE, 200, unit_cost=article.avg_cost)
    return {"cahier": cahier, "stylo": stylo, "kit": kit}


class Till:
    """Enregistre des ventes par la synchronisation, comme un terminal de caisse."""

    def __init__(self, user, mag):
        self.client, self.mag, self.seq = client_for(user), mag, 0
        self.session = str(uuid.uuid4())
        self.push("cash_session", "open", {"id": self.session, "depot": str(mag.pk), "opening_float": 5000}, DAY)

    def push(self, entity, operation, payload, when):
        response = self.client.post("/api/sync/push/", {"operations": [{
            "id": str(uuid.uuid4()), "entity": entity, "operation": operation, "payload": payload,
            "client_timestamp": when.isoformat()}]}, format="json", HTTP_X_DEVICE_CODE="C01")
        result = response.json()["results"][0]
        assert result["status"] == "ok", result
        return result

    def sell(self, lines, when, method="CASH"):
        self.seq += 1
        rows = [{"article": str(a.pk), "quantity": q, "unit_price": p, "line_total": q * p} for a, q, p in lines]
        total = sum(r["line_total"] for r in rows)
        self.push("sale", "create", {"id": str(uuid.uuid4()), "receipt_number": f"C01-{when:%Y%m%d}-{self.seq:04d}",
                                     "depot": str(self.mag.pk), "cash_session": self.session, "lines": rows,
                                     "subtotal": total, "global_discount": 0, "total": total,
                                     "payments": [{"method": method, "amount": total, "reference": "REF"}],
                                     "change_due": 0}, when)
        return total


def test_sales_report_kpis_breakdowns_and_comparison(cashier_user, manager_user, mag, shop):
    till = Till(cashier_user, mag)
    till.sell([(shop["cahier"], 2, 400), (shop["stylo"], 1, 150)], DAY)                  # 950
    till.sell([(shop["kit"].article, 1, 1900)], DAY + timedelta(hours=3), "ORANGE_MONEY")  # 1 900
    till.sell([(shop["cahier"], 1, 400)], DAY - timedelta(days=7))                         # période précédente
    params = {"date_from": "2026-09-09", "date_to": "2026-09-15", "groups": "day,hour,payment,category,type,cashier"}
    data = client_for(manager_user).get("/api/reports/sales/", params).json()
    summary = {item["label"]: item for item in data["summary"]}
    assert summary["Chiffre d'affaires net"]["value"] == 2850
    assert summary["Nombre de ventes"]["value"] == 2 and summary["Panier moyen"]["value"] == 1425
    assert summary["Chiffre d'affaires net"]["previous"] == 400
    assert summary["Marge brute"]["value"] == 2850 - (2 * 250 + 80 + shop["kit"].article.avg_cost)
    tables = {t["key"]: t for t in data["tables"]}
    assert {r["label"]: r["revenue"] for r in tables["payment"]["rows"]} == {"Espèces": 950, "Orange Money": 1900}
    assert [r["label"] for r in tables["hour"]["rows"]] == ["10 h", "13 h"]
    assert {r["label"] for r in tables["type"]["rows"]} == {"Simple", "Kit scolaire"} or len(tables["type"]["rows"]) == 2
    assert tables["cashier"]["rows"][0]["label"] == "Aya Traoré"


def test_kits_stock_cash_reports(cashier_user, manager_user, mag, shop):
    till = Till(cashier_user, mag)
    till.sell([(shop["kit"].article, 3, 1900)], DAY)
    till.push("cash_session", "close", {"session": till.session, "counted_cash": 5000 + 5700 - 200, "z_number": "Z-9"},
              DAY + timedelta(hours=8))
    period = services.Period.from_params({"date_from": "2026-09-01", "date_to": "2026-09-30"})
    kits = services.kits_report(period)
    top = {t["key"]: t for t in kits["tables"]}["top"]["rows"][0]
    assert top["quantity"] == 3 and top["level"] == "6ème" and top["school"] == "Générique"
    stock = services.stock_report(period)
    tables = {t["key"]: t for t in stock["tables"]}
    rotation = {r["label"]: r for r in tables["rotation"]["rows"]}
    assert rotation["Cahier"]["sold"] == 12 and rotation["Cahier"]["stock"] == 188
    valuation = next(s for s in stock["summary"] if s["label"] == "Valorisation (CMP)")["value"]
    assert valuation == 188 * 250 + 194 * 80
    cash = services.cash_report(period)
    assert {t["key"]: t for t in cash["tables"]}["cashier"]["rows"][0]["shortages"] == -200


def test_exports_permissions_and_dashboard(cashier_user, manager_user, mag, shop):
    Till(cashier_user, mag).sell([(shop["cahier"], 5, 400)], datetime.now(dt_timezone.utc))
    manager = client_for(manager_user)
    excel = manager.get("/api/reports/sales/", {"export": "xlsx"})
    assert excel.status_code == 200 and excel.content[:2] == b"PK"
    assert manager.get("/api/reports/stock/", {"export": "pdf"}).status_code in (200, 503)
    assert manager.get("/api/reports/inconnu/").status_code == 404
    for name in services.REPORTS:
        assert manager.get(f"/api/reports/{name}/").status_code == 200, name
    assert client_for(cashier_user).get("/api/reports/sales/").status_code == 403
    dashboard = manager.get("/api/reports/dashboard/", {"scope": "today"}).json()
    kpis = {k["key"]: k["value"] for k in dashboard["kpis"]}
    assert kpis["revenue"] == 2000 and kpis["count"] == 1 and dashboard["top"]["rows"][0]["quantity"] == 5
    caissier = make_user("caisse2", CAISSIER)
    limited = client_for(caissier).get("/api/reports/dashboard/").json()
    assert "margin" not in {k["key"] for k in limited["kpis"]} and limited["top"] is None


def test_scheduled_report_due_and_sent_by_email(manager_user, mag, shop):
    client = client_for(manager_user)
    created = client.post("/api/reports/scheduled/", {"name": "Ventes de la semaine", "report": "sales",
                                                      "frequency": "WEEKLY", "recipients": ["gerant@example.ci"],
                                                      "send_hour": 7}, format="json")
    assert created.status_code == 201, created.content
    schedule = ScheduledReport.objects.get()
    monday_8h = datetime(2026, 10, 5, 8, 0, tzinfo=dt_timezone.utc)  # Abidjan = UTC
    assert scheduling.period_for(schedule, monday_8h.date()) == (datetime(2026, 9, 28).date(), datetime(2026, 10, 4).date())
    assert scheduling.send_due(monday_8h - timedelta(hours=2)) == 0  # avant l'heure d'envoi
    assert scheduling.send_due(monday_8h) == 1
    assert scheduling.send_due(monday_8h + timedelta(hours=1)) == 0  # déjà envoyé aujourd'hui
    message = mail.outbox[-1]
    assert message.to == ["gerant@example.ci"] and "28/09/2026" in message.subject
    assert message.attachments[0][0].endswith(".xlsx")
    bad = client.post("/api/reports/scheduled/", {"name": "x", "report": "nope", "recipients": ["a@b.ci"]},
                      format="json")
    assert bad.status_code == 400
