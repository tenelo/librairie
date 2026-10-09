"""Statistiques consolidées (ventes comptoir et en ligne, kits, stock, commandes, caisses, inventaires).

Chaque rapport renvoie une structure homogène, affichée telle quelle par le backoffice et exportée
en Excel ou en PDF :

    {"key", "title", "period": {...}, "summary": [{"label", "value", "kind", "previous"?}],
     "tables": [{"key", "title", "columns": [{"key", "label", "kind"}], "rows": [...], "chart": {...}?}]}

`kind` vaut `money` (FCFA), `int`, `percent`, `decimal`, `text` ou `date`.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Max, Q, Sum
from django.db.models.functions import Coalesce, ExtractHour, ExtractIsoWeekDay, TruncDate, TruncMonth
from django.utils import timezone

from apps.catalog.models import Article
from apps.inventory.models import InventoryLine, InventorySession
from apps.orders.models import OnlineOrder
from apps.purchasing.services import reorder_suggestions
from apps.sales.models import CashSession, Payment, PaymentMethod, Sale, SaleLine, SaleReturn
from apps.stock.models import Depot, StockAlert, StockLevel, StockMovement

WEEKDAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
MONTHS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
          "novembre", "décembre"]


@dataclass
class Period:
    date_from: date
    date_to: date
    depot: Depot | None = None

    @classmethod
    def from_params(cls, params, default_days=30):
        today = timezone.localdate()
        try:
            date_to = date.fromisoformat(params.get("date_to")) if params.get("date_to") else today
            date_from = (date.fromisoformat(params.get("date_from")) if params.get("date_from")
                         else date_to - timedelta(days=default_days - 1))
        except ValueError:
            date_to, date_from = today, today - timedelta(days=default_days - 1)
        if date_from > date_to:
            date_from, date_to = date_to, date_from
        depot = Depot.objects.filter(pk=params.get("depot")).first() if params.get("depot") else None
        return cls(date_from, date_to, depot)

    @property
    def start(self) -> datetime:
        return timezone.make_aware(datetime.combine(self.date_from, time.min))

    @property
    def end(self) -> datetime:
        return timezone.make_aware(datetime.combine(self.date_to + timedelta(days=1), time.min))

    @property
    def days(self) -> int:
        return (self.date_to - self.date_from).days + 1

    def previous(self) -> "Period":
        return Period(self.date_from - timedelta(days=self.days), self.date_from - timedelta(days=1), self.depot)

    def as_dict(self):
        return {"date_from": self.date_from.isoformat(), "date_to": self.date_to.isoformat(),
                "depot": str(self.depot.pk) if self.depot else None,
                "depot_name": self.depot.name if self.depot else "Tous les dépôts", "days": self.days}


def col(key, label, kind="text"):
    return {"key": key, "label": label, "kind": kind}


def table(key, title, columns, rows, chart=None):
    data = {"key": key, "title": title, "columns": columns, "rows": rows}
    if chart:
        data["chart"] = chart
    return data


def report(key, title, period, summary, tables):
    return {"key": key, "title": title, "period": period.as_dict(), "summary": summary, "tables": tables}


def pct(part, whole) -> float:
    return round(part * 100 / whole, 1) if whole else 0.0


def variation(current, previous) -> float | None:
    return round((current - previous) * 100 / previous, 1) if previous else None


# --- Ventes ------------------------------------------------------------------------------------


def sales_qs(period: Period):
    queryset = Sale.objects.filter(status=Sale.Status.COMPLETED, sold_at__gte=period.start, sold_at__lt=period.end)
    if period.depot:
        queryset = queryset.filter(depot=period.depot)
    return queryset


def sales_kpis(period: Period) -> dict:
    sales = sales_qs(period)
    totals = sales.aggregate(revenue=Coalesce(Sum("total"), 0), count=Count("id"),
                             discounts=Coalesce(Sum("discount_total"), 0))
    cost = SaleLine.objects.filter(sale__in=sales).aggregate(
        cost=Coalesce(Sum(F("unit_cost") * F("quantity")), 0))["cost"]
    returns = SaleReturn.objects.filter(returned_at__gte=period.start, returned_at__lt=period.end)
    if period.depot:
        returns = returns.filter(sale__depot=period.depot)
    refunded = returns.aggregate(total=Coalesce(Sum("total"), 0))["total"]
    revenue = totals["revenue"] - refunded
    return {
        "revenue": revenue, "gross_sales": totals["revenue"], "refunds": refunded, "count": totals["count"],
        "average_basket": round(totals["revenue"] / totals["count"]) if totals["count"] else 0,
        "margin": totals["revenue"] - cost, "margin_rate": pct(totals["revenue"] - cost, totals["revenue"]),
        "discounts": totals["discounts"],
        "online": sales.filter(channel=Sale.Channel.ONLINE).aggregate(t=Coalesce(Sum("total"), 0))["t"],
    }


def _line_rows(lines, group_fields, label):
    rows = (lines.values(*group_fields).annotate(qty=Sum("quantity"), rev=Sum("line_total"),
                                                 cost=Sum(F("unit_cost") * F("quantity")))
            .order_by("-rev"))
    return [{"label": label(row), "quantity": row["qty"], "revenue": row["rev"],
             "margin": row["rev"] - (row["cost"] or 0)} for row in rows]


GROUPINGS = {
    "day": "Par jour", "hour": "Par heure", "weekday": "Par jour de la semaine", "article": "Par article",
    "category": "Par catégorie", "type": "Par type d'article", "cashier": "Par caissier", "device": "Par terminal",
    "payment": "Par mode de paiement", "channel": "Par canal",
}


def sales_breakdown(period: Period, group: str) -> dict:
    sales = sales_qs(period)
    lines = SaleLine.objects.filter(sale__in=sales)
    money = [col("label", GROUPINGS.get(group, "Groupe").replace("Par ", "").capitalize()),
             col("count", "Ventes", "int"), col("revenue", "Chiffre d'affaires", "money"),
             col("average", "Panier moyen", "money")]
    if group in ("day", "hour", "weekday", "cashier", "device", "channel"):
        if group == "day":
            rows = sales.annotate(k=TruncDate("sold_at")).values("k")
            label = lambda k: k.strftime("%d/%m/%Y")  # noqa: E731
        elif group == "hour":
            rows = sales.annotate(k=ExtractHour("sold_at")).values("k")
            label = lambda k: f"{k:02d} h"  # noqa: E731
        elif group == "weekday":
            rows = sales.annotate(k=ExtractIsoWeekDay("sold_at")).values("k")
            label = lambda k: WEEKDAYS[k]  # noqa: E731
        elif group == "cashier":
            rows = sales.annotate(k=F("cashier__username")).values("k", "cashier__first_name", "cashier__last_name")
            label = None
        elif group == "device":
            rows = sales.annotate(k=F("device__code")).values("k")
            label = lambda k: k or "—"  # noqa: E731
        else:
            rows = sales.annotate(k=F("channel")).values("k")
            label = lambda k: Sale.Channel(k).label  # noqa: E731
        data = rows.annotate(count=Count("id"), revenue=Sum("total")).order_by("k" if group in ("day", "hour", "weekday")
                                                                              else "-revenue")
        result = []
        for row in data:
            name = (f"{row.get('cashier__first_name', '')} {row.get('cashier__last_name', '')}".strip() or row["k"]
                    if label is None else label(row["k"]))
            result.append({"label": name, "count": row["count"], "revenue": row["revenue"],
                           "average": round(row["revenue"] / row["count"]) if row["count"] else 0})
        chart = {"type": "line" if group == "day" else "bar", "x": "label", "y": "revenue"}
        return table(group, GROUPINGS[group], money, result, chart)
    if group == "payment":
        payments = Payment.objects.filter(sale__in=sales).values("method__code", "method__label", "method__kind") \
            .annotate(count=Count("sale", distinct=True), amount=Sum("amount")).order_by("-amount")
        change = sales.aggregate(c=Coalesce(Sum("change_due"), 0))["c"]
        rows = []
        for row in payments:
            amount = row["amount"] - (change if row["method__kind"] == PaymentMethod.Kind.CASH else 0)
            rows.append({"label": row["method__label"], "count": row["count"], "revenue": amount})
        total = sum(r["revenue"] for r in rows)
        for r in rows:
            r["share"] = pct(r["revenue"], total)
        return table(group, GROUPINGS[group], [col("label", "Mode de paiement"), col("count", "Ventes", "int"),
                                               col("revenue", "Montant encaissé", "money"), col("share", "Part", "percent")],
                     rows, {"type": "bar", "x": "label", "y": "revenue"})
    columns = [col("label", GROUPINGS.get(group, "").replace("Par ", "").capitalize()), col("quantity", "Quantité", "int"),
               col("revenue", "Chiffre d'affaires", "money"), col("margin", "Marge brute", "money")]
    if group == "category":
        rows = _line_rows(lines, ["article__category__name"], lambda r: r["article__category__name"] or "Sans catégorie")
    elif group == "type":
        rows = _line_rows(lines, ["article__type"], lambda r: Article.Type(r["article__type"]).label)
    else:
        group = "article"
        rows = _line_rows(lines, ["article__code", "article__name"], lambda r: f"{r['article__name']} ({r['article__code']})")
    return table(group, GROUPINGS[group], columns, rows[:200], {"type": "bar", "x": "label", "y": "revenue", "limit": 15})


def sales_report(period: Period, groups=None) -> dict:
    current, previous = sales_kpis(period), sales_kpis(period.previous())
    summary = [
        {"label": "Chiffre d'affaires net", "value": current["revenue"], "kind": "money", "previous": previous["revenue"],
         "variation": variation(current["revenue"], previous["revenue"])},
        {"label": "Nombre de ventes", "value": current["count"], "kind": "int", "previous": previous["count"],
         "variation": variation(current["count"], previous["count"])},
        {"label": "Panier moyen", "value": current["average_basket"], "kind": "money",
         "variation": variation(current["average_basket"], previous["average_basket"])},
        {"label": "Marge brute", "value": current["margin"], "kind": "money",
         "variation": variation(current["margin"], previous["margin"])},
        {"label": "Taux de marge", "value": current["margin_rate"], "kind": "percent"},
        {"label": "Remises accordées", "value": current["discounts"], "kind": "money"},
        {"label": "Retours remboursés", "value": current["refunds"], "kind": "money"},
        {"label": "Dont ventes en ligne", "value": current["online"], "kind": "money"},
    ]
    tables = [sales_breakdown(period, group) for group in (groups or ["day", "channel", "payment", "category"])]
    return report("sales", "Ventes", period, summary, tables)


# --- Kits --------------------------------------------------------------------------------------


def kits_report(period: Period) -> dict:
    lines = SaleLine.objects.filter(sale__in=sales_qs(period), article__type=Article.Type.KIT)
    totals = lines.aggregate(quantity=Coalesce(Sum("quantity"), 0), revenue=Coalesce(Sum("line_total"), 0))
    by_kit = [{"label": row["article__name"], "level": row["article__kit__level__label"],
               "school": row["article__kit__school__name"] or "Générique", "quantity": row["quantity"],
               "revenue": row["revenue"]}
              for row in lines.values("article__name", "article__kit__level__label", "article__kit__school__name")
              .annotate(quantity=Sum("quantity"), revenue=Sum("line_total")).order_by("-revenue")]
    by_level = _line_rows(lines, ["article__kit__level__label", "article__kit__level__sort_order"],
                          lambda r: r["article__kit__level__label"])
    by_school = _line_rows(lines, ["article__kit__school__name"], lambda r: r["article__kit__school__name"] or "Générique")
    # Saisonnalité : 12 derniers mois glissants jusqu'à la fin de la période.
    season_start = timezone.make_aware(datetime.combine(period.date_to.replace(day=1) - timedelta(days=330), time.min))
    seasonal = (SaleLine.objects.filter(sale__status=Sale.Status.COMPLETED, article__type=Article.Type.KIT,
                                        sale__sold_at__gte=season_start, sale__sold_at__lt=period.end)
                .annotate(month=TruncMonth("sale__sold_at")).values("month")
                .annotate(quantity=Sum("quantity"), revenue=Sum("line_total")).order_by("month"))
    season_rows = [{"label": f"{MONTHS[row['month'].month]} {row['month'].year}", "quantity": row["quantity"],
                    "revenue": row["revenue"]} for row in seasonal]
    qty_cols = [col("label", "Libellé"), col("quantity", "Kits vendus", "int"), col("revenue", "Chiffre d'affaires", "money"),
                col("margin", "Marge", "money")]
    return report("kits", "Kits scolaires", period, [
        {"label": "Kits vendus", "value": totals["quantity"], "kind": "int"},
        {"label": "Chiffre d'affaires kits", "value": totals["revenue"], "kind": "money"},
    ], [
        table("top", "Kits les plus vendus", [col("label", "Kit"), col("level", "Niveau"), col("school", "Établissement"),
                                              col("quantity", "Quantité", "int"), col("revenue", "Chiffre d'affaires", "money")],
              by_kit[:50], {"type": "bar", "x": "label", "y": "quantity", "limit": 10}),
        table("level", "Par niveau", qty_cols, by_level, {"type": "bar", "x": "label", "y": "quantity"}),
        table("school", "Par établissement", qty_cols, by_school, {"type": "bar", "x": "label", "y": "quantity"}),
        table("season", "Saisonnalité (12 mois)", [col("label", "Mois"), col("quantity", "Kits vendus", "int"),
                                                   col("revenue", "Chiffre d'affaires", "money")],
              season_rows, {"type": "line", "x": "label", "y": "quantity"}),
    ])


# --- Stock -------------------------------------------------------------------------------------


def stock_report(period: Period, dormant_days=90) -> dict:
    levels = StockLevel.objects.select_related("article", "article__category", "depot").filter(
        article__is_active=True)
    if period.depot:
        levels = levels.filter(depot=period.depot)
    by_article = {}
    for level in levels:
        row = by_article.setdefault(level.article_id, {"article": level.article, "quantity": 0, "reserved": 0})
        row["quantity"] += level.quantity
        row["reserved"] += level.reserved
    movements = StockMovement.objects.filter(kind=StockMovement.Kind.SALE, occurred_at__gte=period.start,
                                             occurred_at__lt=period.end)
    if period.depot:
        movements = movements.filter(depot=period.depot)
    sold = {r["article_id"]: -r["q"] for r in movements.values("article_id").annotate(q=Sum("quantity"))}
    last_sale = dict(StockMovement.objects.filter(kind=StockMovement.Kind.SALE).values("article_id")
                     .annotate(last=Max("occurred_at")).values_list("article_id", "last"))
    valuation_by_category, rotation, dormant, ruptures = {}, [], [], []
    total_value = 0
    dormant_since = timezone.now() - timedelta(days=dormant_days)
    for article_id, row in by_article.items():
        article = row["article"]
        value = max(row["quantity"], 0) * int(article.avg_cost)
        total_value += value
        category = article.category.name if article.category_id else "Sans catégorie"
        bucket = valuation_by_category.setdefault(category, {"label": category, "quantity": 0, "value": 0})
        bucket["quantity"] += max(row["quantity"], 0)
        bucket["value"] += value
        qty_sold = sold.get(article_id, 0)
        if qty_sold:
            daily = qty_sold / period.days
            rotation.append({"label": article.name, "sold": qty_sold, "stock": row["quantity"],
                             "rotation": round(qty_sold / row["quantity"], 2) if row["quantity"] > 0 else None,
                             "coverage": round(row["quantity"] / daily) if daily and row["quantity"] > 0 else 0})
        if row["quantity"] > 0 and (last_sale.get(article_id) is None or last_sale[article_id] < dormant_since):
            dormant.append({"label": article.name, "stock": row["quantity"], "value": value,
                            "last_sale": last_sale[article_id].date().isoformat() if last_sale.get(article_id) else None})
        if article.type == Article.Type.SIMPLE and row["quantity"] - row["reserved"] <= 0:
            ruptures.append({"label": article.name, "stock": row["quantity"], "reserved": row["reserved"],
                             "threshold": article.alert_threshold})
    rotation.sort(key=lambda r: -(r["rotation"] or 0))
    dormant.sort(key=lambda r: -r["value"])
    forecast = [{"label": s["article"].name, "available": s["available"], "on_order": s["on_order"],
                 "daily": s["daily_sales"], "suggested": s["suggested_quantity"],
                 "supplier": s["supplier"].name if s["supplier"] else "—",
                 "cost": s["suggested_quantity"] * s["unit_cost"]} for s in reorder_suggestions(days=max(period.days, 30))]
    return report("stock", "Stock", period, [
        {"label": "Valorisation (CMP)", "value": total_value, "kind": "money"},
        {"label": "Articles en stock", "value": sum(1 for r in by_article.values() if r["quantity"] > 0), "kind": "int"},
        {"label": "Ruptures", "value": len(ruptures), "kind": "int"},
        {"label": f"Articles dormants (> {dormant_days} j)", "value": len(dormant), "kind": "int"},
        {"label": "Alertes ouvertes", "value": StockAlert.objects.filter(resolved_at__isnull=True).count(), "kind": "int"},
        {"label": "Réapprovisionnement suggéré", "value": sum(f["cost"] for f in forecast), "kind": "money"},
    ], [
        table("valuation", "Valorisation par catégorie", [col("label", "Catégorie"), col("quantity", "Unités", "int"),
                                                           col("value", "Valeur (CMP)", "money")],
              sorted(valuation_by_category.values(), key=lambda r: -r["value"]), {"type": "bar", "x": "label", "y": "value"}),
        table("rotation", "Rotation sur la période", [col("label", "Article"), col("sold", "Vendus", "int"),
                                                       col("stock", "Stock", "int"), col("rotation", "Rotation", "decimal"),
                                                       col("coverage", "Couverture (jours)", "int")], rotation[:100]),
        table("dormant", "Articles dormants", [col("label", "Article"), col("stock", "Stock", "int"),
                                               col("value", "Valeur", "money"), col("last_sale", "Dernière vente", "date")],
              dormant[:100]),
        table("ruptures", "Ruptures", [col("label", "Article"), col("stock", "Physique", "int"),
                                       col("reserved", "Réservé", "int"), col("threshold", "Seuil", "int")], ruptures),
        table("forecast", "Prévisions de réapprovisionnement", [col("label", "Article"), col("available", "Disponible", "int"),
                                                                 col("on_order", "En commande", "int"),
                                                                 col("daily", "Ventes / jour", "decimal"),
                                                                 col("suggested", "À commander", "int"),
                                                                 col("supplier", "Fournisseur"), col("cost", "Coût estimé", "money")],
              forecast),
    ])


# --- Commandes en ligne ------------------------------------------------------------------------


def orders_report(period: Period) -> dict:
    orders = OnlineOrder.objects.filter(created_at__gte=period.start, created_at__lt=period.end)
    if period.depot:
        orders = orders.filter(pickup_depot=period.depot)
    total = orders.count()
    counts = {row["status"]: row["n"] for row in orders.values("status").annotate(n=Count("id"))}
    closed = sum(counts.get(s, 0) for s in ("PICKED_UP", "CANCELLED", "EXPIRED"))
    prep = orders.filter(confirmed_at__isnull=False, ready_at__isnull=False).aggregate(
        avg=Avg(ExpressionWrapper(F("ready_at") - F("confirmed_at"), output_field=DurationField())))["avg"]
    wait = orders.filter(ready_at__isnull=False, picked_up_at__isnull=False).aggregate(
        avg=Avg(ExpressionWrapper(F("picked_up_at") - F("ready_at"), output_field=DurationField())))["avg"]
    revenue = orders.filter(status=OnlineOrder.Status.PICKED_UP).aggregate(t=Coalesce(Sum("total"), 0))["t"]
    hours = lambda d: round(d.total_seconds() / 3600, 1) if d else 0  # noqa: E731
    by_day = orders.annotate(day=TruncDate("created_at")).values("day").annotate(
        n=Count("id"), picked=Count("id", filter=Q(status=OnlineOrder.Status.PICKED_UP))).order_by("day")
    return report("orders", "Commandes en ligne", period, [
        {"label": "Commandes", "value": total, "kind": "int"},
        {"label": "Taux de retrait", "value": pct(counts.get("PICKED_UP", 0), closed), "kind": "percent"},
        {"label": "Taux d'annulation", "value": pct(counts.get("CANCELLED", 0), closed), "kind": "percent"},
        {"label": "Taux d'expiration", "value": pct(counts.get("EXPIRED", 0), closed), "kind": "percent"},
        {"label": "Délai moyen de préparation (h)", "value": hours(prep), "kind": "decimal"},
        {"label": "Délai moyen avant retrait (h)", "value": hours(wait), "kind": "decimal"},
        {"label": "Chiffre d'affaires retiré", "value": revenue, "kind": "money"},
    ], [
        table("status", "Par statut", [col("label", "Statut"), col("count", "Commandes", "int"), col("share", "Part", "percent")],
              [{"label": OnlineOrder.Status(s).label, "count": n, "share": pct(n, total)} for s, n in
               sorted(counts.items(), key=lambda item: -item[1])], {"type": "bar", "x": "label", "y": "count"}),
        table("day", "Par jour", [col("label", "Jour"), col("count", "Commandes", "int"), col("picked", "Retirées", "int")],
              [{"label": r["day"].strftime("%d/%m/%Y"), "count": r["n"], "picked": r["picked"]} for r in by_day],
              {"type": "line", "x": "label", "y": "count"}),
    ])


# --- Caisses -----------------------------------------------------------------------------------


def cash_report(period: Period) -> dict:
    sessions = CashSession.objects.filter(status=CashSession.Status.CLOSED, closed_at__gte=period.start,
                                          closed_at__lt=period.end)
    if period.depot:
        sessions = sessions.filter(depot=period.depot)
    rows = []
    for row in (sessions.values("opened_by__username", "opened_by__first_name", "opened_by__last_name")
                .annotate(n=Count("id"), net=Coalesce(Sum("variance"), 0),
                          shortages=Coalesce(Sum("variance", filter=Q(variance__lt=0)), 0),
                          surpluses=Coalesce(Sum("variance", filter=Q(variance__gt=0)), 0),
                          with_variance=Count("id", filter=~Q(variance=0)))
                .order_by("shortages")):
        name = f"{row['opened_by__first_name']} {row['opened_by__last_name']}".strip() or row["opened_by__username"]
        rows.append({"label": name, "sessions": row["n"], "with_variance": row["with_variance"],
                     "shortages": row["shortages"], "surpluses": row["surpluses"], "variance": row["net"]})
    detail = [{"label": s.z_number or str(s.pk)[:8], "date": s.closed_at.date().isoformat(), "device": s.device.code
               if s.device_id else "—", "cashier": s.opened_by.get_full_name() or s.opened_by.username,
               "expected": s.expected_cash, "counted": s.counted_cash, "variance": s.variance}
              for s in sessions.select_related("device", "opened_by").order_by("-closed_at")[:200]]
    totals = sessions.aggregate(n=Count("id"), net=Coalesce(Sum("variance"), 0),
                                abs_short=Coalesce(Sum("variance", filter=Q(variance__lt=0)), 0))
    return report("cash", "Caisses", period, [
        {"label": "Clôtures", "value": totals["n"], "kind": "int"},
        {"label": "Écart net", "value": totals["net"], "kind": "money"},
        {"label": "Total des manques", "value": totals["abs_short"], "kind": "money"},
    ], [
        table("cashier", "Écarts par caissier", [col("label", "Caissier"), col("sessions", "Sessions", "int"),
                                                 col("with_variance", "Avec écart", "int"), col("shortages", "Manques", "money"),
                                                 col("surpluses", "Excédents", "money"), col("variance", "Écart net", "money")],
              rows, {"type": "bar", "x": "label", "y": "variance"}),
        table("sessions", "Clôtures", [col("label", "Rapport Z"), col("date", "Date", "date"), col("device", "Terminal"),
                                       col("cashier", "Caissier"), col("expected", "Attendu", "money"),
                                       col("counted", "Compté", "money"), col("variance", "Écart", "money")], detail),
    ])


# --- Inventaires -------------------------------------------------------------------------------


def inventories_report(period: Period) -> dict:
    sessions = InventorySession.objects.filter(status__in=[InventorySession.Status.VALIDATED,
                                                           InventorySession.Status.CLOSED],
                                               validated_at__gte=period.start, validated_at__lt=period.end)
    if period.depot:
        sessions = sessions.filter(depot=period.depot)
    rows = []
    for session in sessions.select_related("depot").order_by("-validated_at"):
        lines = InventoryLine.objects.filter(session=session)
        agg = lines.aggregate(value=Coalesce(Sum("variance_value"), 0), n=Count("id"),
                              diff=Count("id", filter=~Q(variance=0)),
                              losses=Coalesce(Sum("variance_value", filter=Q(variance_value__lt=0)), 0))
        rows.append({"label": f"{session.number} · {session.name}", "date": session.validated_at.date().isoformat(),
                     "kind": session.get_kind_display(), "depot": session.depot.name, "articles": agg["n"],
                     "with_variance": agg["diff"], "losses": agg["losses"], "value": agg["value"]})
    return report("inventories", "Inventaires", period, [
        {"label": "Inventaires validés", "value": len(rows), "kind": "int"},
        {"label": "Écart net valorisé", "value": sum(r["value"] for r in rows), "kind": "money"},
        {"label": "Démarque (écarts négatifs)", "value": sum(r["losses"] for r in rows), "kind": "money"},
    ], [
        table("history", "Historique des écarts", [col("label", "Inventaire"), col("date", "Validé le", "date"),
                                                   col("kind", "Type"), col("depot", "Dépôt"),
                                                   col("articles", "Articles", "int"),
                                                   col("with_variance", "Avec écart", "int"),
                                                   col("losses", "Démarque", "money"), col("value", "Écart net", "money")],
              rows, {"type": "bar", "x": "label", "y": "value"}),
    ])


# --- Tableau de bord ---------------------------------------------------------------------------


def dashboard(scope: str = "today", depot=None) -> dict:
    today = timezone.localdate()
    starts = {"today": today, "week": today - timedelta(days=today.weekday()), "month": today.replace(day=1)}
    period = Period(starts.get(scope, today), today, depot)
    current = sales_kpis(period)
    previous = sales_kpis(period.previous())
    orders = OnlineOrder.objects.filter(status__in=OnlineOrder.OPEN)
    if depot:
        orders = orders.filter(pickup_depot=depot)
    by_status = {row["status"]: row["n"] for row in orders.values("status").annotate(n=Count("id"))}
    alerts = StockAlert.objects.filter(resolved_at__isnull=True)
    hourly = sales_breakdown(period, "hour" if scope == "today" else "day")
    top = sales_breakdown(period, "article")
    top["rows"] = top["rows"][:8]
    return {
        "scope": scope, "period": period.as_dict(),
        "kpis": [
            {"key": "revenue", "label": "Chiffre d'affaires", "value": current["revenue"], "kind": "money",
             "variation": variation(current["revenue"], previous["revenue"])},
            {"key": "count", "label": "Ventes", "value": current["count"], "kind": "int",
             "variation": variation(current["count"], previous["count"])},
            {"key": "basket", "label": "Panier moyen", "value": current["average_basket"], "kind": "money",
             "variation": variation(current["average_basket"], previous["average_basket"])},
            {"key": "margin", "label": "Marge brute", "value": current["margin"], "kind": "money",
             "variation": variation(current["margin"], previous["margin"])},
        ],
        "orders": [{"status": s, "label": OnlineOrder.Status(s).label, "count": by_status.get(s, 0)}
                   for s in OnlineOrder.OPEN],
        "alerts": {"low": alerts.filter(kind=StockAlert.Kind.LOW).count(),
                   "out": alerts.filter(kind=StockAlert.Kind.OUT).count()},
        "chart": hourly, "top": top,
    }


REPORTS = {
    "sales": ("Ventes", lambda period, params: sales_report(
        period, [g for g in (params.get("groups") or "").split(",") if g in GROUPINGS] or None)),
    "kits": ("Kits scolaires", lambda period, params: kits_report(period)),
    "stock": ("Stock", lambda period, params: stock_report(period, int(params.get("dormant_days") or 90))),
    "orders": ("Commandes en ligne", lambda period, params: orders_report(period)),
    "cash": ("Caisses", lambda period, params: cash_report(period)),
    "inventories": ("Inventaires", lambda period, params: inventories_report(period)),
}


def build(name: str, params) -> dict:
    period = Period.from_params(params)
    return REPORTS[name][1](period, params)
