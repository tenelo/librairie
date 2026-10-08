"""Cycle d'inventaire : création → gel du stock théorique → comptage → revue → validation (ajustements) → clôture.

Calcul de l'écart par article :
- théorique = stock du dépôt au gel (somme des mouvements jusqu'à `frozen_at`) ;
- mouvements pendant l'inventaire = mouvements du dépôt entre le gel et le dernier comptage de
  l'article (ventes, réceptions… faites pendant que l'on comptait) ;
- attendu = théorique + mouvements pendant ; écart = compté − attendu.
L'ajustement passé à la validation (= écart) corrige le stock actuel sans écraser les mouvements
postérieurs au comptage.
"""
from dataclasses import dataclass
from django.db import transaction
from django.db.models import Max, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.catalog.models import Article, Kit
from apps.core.signals import business_event
from apps.stock.models import StockLevel, StockMovement
from apps.stock.services import record_movement, refresh_alerts

from .models import InventoryCount, InventoryLine, InventorySession, InventorySnapshot

Status = InventorySession.Status


def scope_queryset(session: InventorySession):
    """Articles stockés couverts par l'inventaire."""
    queryset = Article.objects.filter(is_active=True).filter(
        Q(type=Article.Type.SIMPLE) | Q(type=Article.Type.KIT, kit__stock_mode=Kit.StockMode.ASSEMBLED))
    if session.kind == InventorySession.Kind.CYCLE:
        return queryset.filter(pk__in=session.articles.values("pk"))
    if session.kind == InventorySession.Kind.PARTIAL:
        filters = Q()
        category_ids = []
        for category in session.categories.all():
            category_ids += category.descendant_ids()
        if category_ids:
            filters |= Q(category_id__in=category_ids)
        location_ids = list(session.locations.values_list("pk", flat=True))
        if location_ids:
            filters |= Q(pk__in=StockLevel.objects.filter(depot=session.depot, location_id__in=location_ids)
                         .values("article_id"))
        if not filters:
            raise ValidationError({"scope": "Un inventaire partiel doit cibler des catégories ou des emplacements."})
        queryset = queryset.filter(filters)
    return queryset


def theoretical_at(article_id, depot, when) -> int:
    return (StockMovement.objects.filter(article_id=article_id, depot=depot, occurred_at__lte=when)
            .exclude(kind__in=StockMovement.RESERVATION_KINDS).aggregate(t=Sum("quantity"))["t"] or 0)


@transaction.atomic
def start(session: InventorySession, user):
    if session.status != Status.DRAFT:
        raise ValidationError({"status": "L'inventaire a déjà démarré."})
    session.frozen_at = timezone.now()
    articles = list(scope_queryset(session))
    if not articles:
        raise ValidationError({"scope": "Aucun article stocké dans le périmètre de l'inventaire."})
    InventorySnapshot.objects.bulk_create([
        InventorySnapshot(session=session, article=article, unit_cost=article.avg_cost,
                          theoretical=theoretical_at(article.pk, session.depot, session.frozen_at))
        for article in articles
    ])
    session.status = Status.COUNTING
    session.save(update_fields=["frozen_at", "status"])
    log_event(AuditLog.Action.UPDATE, user=user, entity="InventorySession", entity_id=session.pk,
              description=f"Démarrage de l'inventaire {session.number} : stock théorique gelé ({len(articles)} articles)")
    return session


def add_count(context, payload):
    existing = InventoryCount.all_objects.filter(pk=payload["id"]).first()
    if existing:
        return existing
    session = InventorySession.objects.get(pk=payload["session"])
    if session.status not in InventorySession.COUNTABLE:
        raise ValidationError({"session": "Les comptages de cet inventaire sont clos."})
    article = Article.objects.get(pk=payload["article"])
    quantity = int(payload["quantity"])
    if quantity < 0:
        raise ValidationError({"quantity": "Quantité négative impossible (saisissez une correction séparée)."})
    count_round = int(payload.get("round", 1))
    if count_round not in (1, 2):
        raise ValidationError({"round": "Tour de comptage invalide."})
    if not InventorySnapshot.objects.filter(session=session, article=article).exists():
        # Article trouvé hors périmètre (mal rangé) : ajouté avec son stock théorique au gel.
        InventorySnapshot.objects.create(session=session, article=article, unit_cost=article.avg_cost,
                                         theoretical=theoretical_at(article.pk, session.depot, session.frozen_at))
    return InventoryCount.objects.create(
        id=payload["id"], session=session, article=article, quantity=quantity, count_round=count_round,
        location=(payload.get("location") or "")[:50], user=context.user,
        counted_at=context.client_timestamp or timezone.now(), device=context.device,
        client_timestamp=context.client_timestamp,
    )


@dataclass
class VarianceLine:
    article: Article
    theoretical: int
    movements_during: int
    expected: int
    first_count: int | None
    second_count: int | None
    counted: int | None
    variance: int | None
    unit_cost: int
    needs_recount: bool

    @property
    def variance_value(self) -> int:
        return (self.variance or 0) * self.unit_cost

    def as_dict(self):
        return {"article": str(self.article.pk), "code": self.article.code, "name": self.article.name,
                "theoretical": self.theoretical, "movements_during": self.movements_during, "expected": self.expected,
                "first_count": self.first_count, "second_count": self.second_count, "counted": self.counted,
                "variance": self.variance, "unit_cost": self.unit_cost, "variance_value": self.variance_value,
                "needs_recount": self.needs_recount}


def variance_report(session: InventorySession) -> list[VarianceLine]:
    snapshots = {s.article_id: s for s in session.snapshots.select_related("article")}
    counts = {}
    for row in (session.counts.values("article_id", "count_round")
                .annotate(total=Sum("quantity"), last=Max("counted_at"))):
        counts.setdefault(row["article_id"], {})[row["count_round"]] = (row["total"], row["last"])
    lines = []
    for article_id, snapshot in snapshots.items():
        rounds = counts.get(article_id, {})
        first = rounds.get(1)
        second = rounds.get(2)
        last_counted = max([r[1] for r in rounds.values()], default=None)
        during = 0
        if last_counted is not None:
            during = (StockMovement.objects.filter(article_id=article_id, depot=session.depot,
                                                   occurred_at__gt=session.frozen_at, occurred_at__lte=last_counted)
                      .exclude(kind__in=StockMovement.RESERVATION_KINDS)
                      .exclude(source_type="InventorySession").aggregate(t=Sum("quantity"))["t"] or 0)
        expected = snapshot.theoretical + during
        counted = second[0] if second else (first[0] if first else None)
        needs_recount = (session.counting_mode == InventorySession.CountingMode.DOUBLE and first is not None
                         and second is None and abs(first[0] - expected) > session.double_count_threshold)
        lines.append(VarianceLine(
            article=snapshot.article, theoretical=snapshot.theoretical, movements_during=during, expected=expected,
            first_count=first[0] if first else None, second_count=second[0] if second else None, counted=counted,
            variance=None if counted is None else counted - expected, unit_cost=snapshot.unit_cost,
            needs_recount=needs_recount,
        ))
    return sorted(lines, key=lambda line: line.article.name)


def to_review(session: InventorySession, user):
    if session.status != Status.COUNTING:
        raise ValidationError({"status": "L'inventaire n'est pas en comptage."})
    session.status = Status.REVIEW
    session.save(update_fields=["status"])
    transaction.on_commit(lambda: business_event.send(sender=InventorySession, event="inventory_to_review",
                                                      instance=session, user=user))
    return session


@transaction.atomic
def validate(session: InventorySession, user, uncounted_as_zero=False, request=None):
    """Validation (gérant / administrateur, en ligne) : ajustements de stock et rapport définitif."""
    if session.status not in InventorySession.COUNTABLE:
        raise ValidationError({"status": "Seul un inventaire en comptage ou en revue peut être validé."})
    report = variance_report(session)
    pending = [line.article.name for line in report if line.needs_recount]
    if pending:
        raise ValidationError({"recount": f"Deuxième comptage requis : {', '.join(pending[:10])}."})
    adjustments, touched = 0, []
    for line in report:
        if line.counted is None:
            if not uncounted_as_zero:
                InventoryLine.objects.create(session=session, article=line.article, theoretical=line.theoretical,
                                             movements_during=line.movements_during, expected=line.expected,
                                             counted=None, variance=0, unit_cost=line.unit_cost, variance_value=0)
                continue
            line.counted = 0
            line.variance = -line.expected
        InventoryLine.objects.create(session=session, article=line.article, theoretical=line.theoretical,
                                     movements_during=line.movements_during, expected=line.expected,
                                     counted=line.counted, variance=line.variance, unit_cost=line.unit_cost,
                                     variance_value=line.variance_value)
        if line.variance:
            record_movement(line.article, session.depot, StockMovement.Kind.ADJUSTMENT, line.variance,
                            unit_cost=line.unit_cost, user=user, reference=session.number,
                            source_type="InventorySession", source_id=session.pk,
                            reason=f"Inventaire {session.number}", convert=False)
            adjustments += 1
            touched.append(line.article)
    session.status = Status.VALIDATED
    session.validated_by = user
    session.validated_at = timezone.now()
    session.save(update_fields=["status", "validated_by", "validated_at"])
    refresh_alerts(touched)
    total_value = sum(line.variance_value for line in report if line.variance)
    log_event(AuditLog.Action.INVENTORY_VALIDATE, request=request, user=user, entity="InventorySession",
              entity_id=session.pk, description=f"Validation de l'inventaire {session.number} : {adjustments} "
                                                f"ajustement(s), écart valorisé {total_value} FCFA")
    return session


def summary(session: InventorySession) -> dict:
    lines = list(session.lines.all()) if session.status in (Status.VALIDATED, Status.CLOSED) else None
    if lines is None:
        report = variance_report(session)
        counted = [line for line in report if line.counted is not None]
        return {"articles": len(report), "counted": len(counted),
                "to_recount": sum(1 for line in report if line.needs_recount),
                "variance_value": sum(line.variance_value for line in counted),
                "variance_units": sum(abs(line.variance or 0) for line in counted)}
    counted = [line for line in lines if line.counted is not None]
    return {"articles": len(lines), "counted": len(counted), "to_recount": 0,
            "variance_value": sum(line.variance_value for line in lines),
            "variance_units": sum(abs(line.variance) for line in lines)}

