"""Opérations de stock. Toute écriture passe par `record_movement`, seule à toucher aux niveaux.

- Stock physique d'un article dans un dépôt = somme de ses mouvements hors réservations.
- Quantité réservée = somme des mouvements de réservation (positifs) et de libération (négatifs).
- Disponible = physique − réservé.
- Le coût moyen pondéré (CMP) est global à l'article (tous dépôts) et recalculé à chaque réception.
"""
from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.catalog.models import Article, Kit, PriceHistory
from apps.catalog.services import refresh_kits_cost_using
from apps.core.money import to_fcfa
from apps.core.numbering import next_document_number

from .models import Depot, KitAssembly, StockAlert, StockLevel, StockMovement, StockTransfer

Kind = StockMovement.Kind


class InsufficientStock(ValidationError):
    pass


def stock_target(article: Article, quantity: int):
    """Article réellement suivi en stock et quantité correspondante.

    - LOT : converti en unités de l'article de base (un paquet de 10 = 10 stylos) ;
    - SERVICE et KIT virtuel : pas de stock propre (None) — le kit virtuel est décomposé par l'appelant ;
    - SIMPLE et KIT pré-assemblé : inchangés.
    """
    if article.type == Article.Type.SERVICE:
        return None, 0
    if article.type == Article.Type.LOT:
        if not article.lot_base_article_id or not article.lot_units:
            raise ValidationError({"article": f"Le lot « {article.name} » n'a pas d'article de base."})
        return article.lot_base_article, quantity * article.lot_units
    if article.type == Article.Type.KIT and article.kit.stock_mode == Kit.StockMode.VIRTUAL:
        return None, 0
    return article, quantity


def _level_for_update(article_id, depot_id) -> StockLevel:
    level = StockLevel.all_objects.select_for_update().filter(article_id=article_id, depot_id=depot_id).first()
    if level is None:
        level = StockLevel(article_id=article_id, depot_id=depot_id)
        level.save()
        level = StockLevel.all_objects.select_for_update().get(pk=level.pk)
    return level


@transaction.atomic
def record_movement(article, depot, kind, quantity, *, unit_cost=0, user=None, occurred_at=None, reason="",
                    reference="", source_type="", source_id="", movement_id=None, allow_negative=True,
                    device=None, client_timestamp=None, convert=True):
    """Enregistre un mouvement et met à jour le niveau de stock correspondant.

    Idempotent : si `movement_id` (UUID généré par le terminal) existe déjà, le mouvement
    existant est renvoyé sans rien réécrire. Avec `allow_negative=False`, refuse un mouvement
    qui rendrait le stock physique (ou disponible pour une réservation) négatif.
    """
    if movement_id is not None:
        existing = StockMovement.all_objects.filter(pk=movement_id).first()
        if existing is not None:
            return existing
    if convert:
        target, quantity = stock_target(article, quantity)
        if target is None:
            return None
        if article.type == Article.Type.LOT and unit_cost:
            unit_cost = to_fcfa(Decimal(unit_cost) / article.lot_units)
        article = target
    movement = StockMovement(
        article=article, depot=depot, kind=kind, quantity=int(quantity), unit_cost=int(unit_cost or 0),
        user=user, occurred_at=occurred_at or timezone.now(), reason=reason[:255], reference=reference[:60],
        source_type=source_type, source_id=str(source_id or ""), device=device, client_timestamp=client_timestamp,
    )
    if movement_id is not None:
        movement.id = movement_id
    try:
        movement.clean()
    except Exception as exc:
        raise ValidationError(getattr(exc, "message_dict", {"quantity": [str(exc)]})) from exc

    level = _level_for_update(article.pk, depot.pk)
    if movement.is_reservation:
        if not allow_negative and quantity > 0 and level.available - quantity < 0:
            raise InsufficientStock({"quantity": f"Stock disponible insuffisant pour « {article.name} » "
                                                 f"({level.available} disponible(s))."})
        StockLevel.all_objects.filter(pk=level.pk).update(reserved=F("reserved") + quantity)
    else:
        if not allow_negative and quantity < 0 and level.quantity + quantity < 0:
            raise InsufficientStock({"quantity": f"Stock insuffisant pour « {article.name} » dans {depot.code} "
                                                 f"({level.quantity} en stock, {-quantity} demandé(s))."})
        StockLevel.all_objects.filter(pk=level.pk).update(quantity=F("quantity") + quantity)
    level.refresh_from_db()
    level.save(update_fields=[])  # nouvelle sync_version : le niveau sera renvoyé aux terminaux
    movement.save()
    return movement


# --- Lecture ---------------------------------------------------------------------------------


def on_hand(article, depot=None) -> int:
    levels = StockLevel.objects.filter(article=article)
    if depot is not None:
        levels = levels.filter(depot=depot)
    return levels.aggregate(total=Sum("quantity"))["total"] or 0


def available(article, depot=None) -> int:
    levels = StockLevel.objects.filter(article=article)
    if depot is not None:
        levels = levels.filter(depot=depot)
    totals = levels.aggregate(quantity=Sum("quantity"), reserved=Sum("reserved"))
    return (totals["quantity"] or 0) - (totals["reserved"] or 0)


def stock_lookup(depot=None):
    """Fonction `article_id -> disponible` (mise en cache) pour les calculs de disponibilité des kits."""
    levels = StockLevel.objects.all()
    if depot is not None:
        levels = levels.filter(depot=depot)
    totals = {}
    for row in levels.values("article_id").annotate(q=Sum("quantity"), r=Sum("reserved")):
        totals[row["article_id"]] = (row["q"] or 0) - (row["r"] or 0)
    return lambda article_id: totals.get(article_id, 0)


@dataclass
class CardLine:
    movement: StockMovement
    balance: int


def stock_card(article, depot=None, limit=500):
    """Fiche de stock : mouvements (hors réservations) du plus ancien au plus récent avec solde progressif."""
    movements = StockMovement.objects.filter(article=article).exclude(kind__in=StockMovement.RESERVATION_KINDS)
    if depot is not None:
        movements = movements.filter(depot=depot)
    movements = list(movements.select_related("depot", "user").order_by("occurred_at", "created_at"))
    balance, lines = 0, []
    for movement in movements:
        balance += movement.quantity
        lines.append(CardLine(movement, balance))
    return lines[-limit:]


# --- Coût moyen pondéré ------------------------------------------------------------------------


def update_average_cost(article, quantity, unit_cost, user=None, reason="Réception"):
    """Nouveau CMP = (stock avant × CMP + quantité reçue × coût) ÷ (stock avant + quantité reçue).

    À appeler AVANT d'enregistrer le mouvement d'entrée. Si le stock avant est nul ou négatif,
    le CMP devient le coût de la réception. Les kits qui contiennent l'article voient leur coût
    (et donc leur marge) recalculé.
    """
    if quantity <= 0:
        return article.avg_cost
    before = max(on_hand(article), 0)
    old_cost = int(article.avg_cost)
    if before == 0:
        new_cost = int(unit_cost)
    else:
        new_cost = to_fcfa((Decimal(before) * old_cost + Decimal(quantity) * int(unit_cost)) / (before + quantity))
    if new_cost != old_cost:
        article.avg_cost = new_cost
        article.save(update_fields=["avg_cost"])
        PriceHistory.objects.create(article=article, field="avg_cost", old_value=str(old_cost),
                                    new_value=str(new_cost), reason=reason, changed_by=user)
        refresh_kits_cost_using(article, user=user)
    return new_cost


# --- Alertes ---------------------------------------------------------------------------------


def refresh_alerts(articles):
    """Ouvre ou résout les alertes (stock disponible tous dépôts ≤ seuil d'alerte, ou ≤ 0)."""
    now = timezone.now()
    for article in articles:
        if not article.tracks_stock or not article.is_active:
            continue
        if article.type == Article.Type.KIT and article.kit.stock_mode == Kit.StockMode.VIRTUAL:
            continue
        qty = available(article)
        kind = StockAlert.Kind.OUT if qty <= 0 else (
            StockAlert.Kind.LOW if qty <= article.alert_threshold else None)
        open_alert = StockAlert.objects.filter(article=article, resolved_at__isnull=True).first()
        if kind is None:
            if open_alert:
                open_alert.resolved_at = now
                open_alert.save(update_fields=["resolved_at"])
            continue
        if open_alert and open_alert.kind == kind:
            continue
        if open_alert:
            open_alert.resolved_at = now
            open_alert.save(update_fields=["resolved_at"])
        StockAlert.objects.create(article=article, kind=kind, available=qty, threshold=article.alert_threshold)


def refresh_all_alerts():
    """Recalcule les alertes de tous les articles stockés (tâche Celery périodique)."""
    articles = Article.objects.filter(is_active=True).filter(
        Q(type=Article.Type.SIMPLE) | Q(type=Article.Type.KIT, kit__stock_mode=Kit.StockMode.ASSEMBLED)
    ).select_related("kit")
    refresh_alerts(articles)
    return StockAlert.objects.filter(resolved_at__isnull=True).count()


# --- Opérations ------------------------------------------------------------------------------


@transaction.atomic
def adjust(article, depot, quantity, *, kind=Kind.LOSS, reason="", user=None, allow_negative=False):
    """Perte / casse (sortie) ou ajustement manuel (signé). Motif obligatoire."""
    if not reason.strip():
        raise ValidationError({"reason": "Le motif est obligatoire."})
    if stock_target(article, 1)[0] is None:
        raise ValidationError({"article": "Cet article n'a pas de stock propre (service ou kit virtuel)."})
    if kind == Kind.LOSS:
        quantity = -abs(quantity)
    movement = record_movement(article, depot, kind, quantity, user=user, reason=reason, unit_cost=article.avg_cost,
                               source_type=kind, allow_negative=allow_negative)
    refresh_alerts([movement.article])
    return movement


@transaction.atomic
def validate_transfer(transfer: StockTransfer, user=None):
    if transfer.status != StockTransfer.Status.DRAFT:
        raise ValidationError({"status": "Seul un transfert en brouillon peut être validé."})
    if transfer.from_depot_id == transfer.to_depot_id:
        raise ValidationError({"to_depot": "Les dépôts de départ et d'arrivée doivent être différents."})
    lines = list(transfer.lines.select_related("article", "article__kit"))
    if not lines:
        raise ValidationError({"lines": "Le transfert ne contient aucun article."})
    for line in lines:
        common = {"user": user, "reference": transfer.number, "source_type": "StockTransfer",
                  "source_id": transfer.pk, "unit_cost": line.article.avg_cost}
        record_movement(line.article, transfer.from_depot, Kind.TRANSFER_OUT, -line.quantity,
                        allow_negative=False, **common)
        record_movement(line.article, transfer.to_depot, Kind.TRANSFER_IN, line.quantity, **common)
    transfer.status = StockTransfer.Status.VALIDATED
    transfer.validated_by = user
    transfer.validated_at = timezone.now()
    transfer.save(update_fields=["status", "validated_by", "validated_at"])
    return transfer


@transaction.atomic
def assemble_kits(kit: Kit, depot: Depot, quantity: int, operation: str, user=None, note=""):
    """Assemblage : consomme les composants obligatoires et crée N kits ; désassemblage : l'inverse.

    Les composants facultatifs ne sont pas inclus dans un kit pré-assemblé (le client peut les
    ajouter à part). Le coût unitaire des mouvements est le CMP, ce qui conserve la valorisation.
    """
    if kit.stock_mode != Kit.StockMode.ASSEMBLED:
        raise ValidationError({"kit": "Seuls les kits en mode « pré-assemblé » s'assemblent."})
    if quantity <= 0:
        raise ValidationError({"quantity": "Indiquez un nombre de kits positif."})
    components = [c for c in kit.components.select_related("article", "article__lot_base_article")
                  if not c.is_optional]
    if not components:
        raise ValidationError({"kit": "Ce kit n'a aucun composant obligatoire."})
    assembly = KitAssembly.objects.create(number=next_document_number("ASM"), kit=kit, depot=depot,
                                          operation=operation, quantity=quantity, user=user, note=note)
    common = {"user": user, "reference": assembly.number, "source_type": "KitAssembly", "source_id": assembly.pk}
    kit_article = kit.article
    if operation == KitAssembly.Operation.ASSEMBLE:
        for component in components:
            record_movement(component.article, depot, Kind.ASSEMBLY_OUT, -component.quantity * quantity,
                            unit_cost=component.article.avg_cost, allow_negative=False, **common)
        record_movement(kit_article, depot, Kind.ASSEMBLY_IN, quantity, unit_cost=kit_article.avg_cost, **common)
    else:
        record_movement(kit_article, depot, Kind.DISASSEMBLY_OUT, -quantity, unit_cost=kit_article.avg_cost,
                        allow_negative=False, **common)
        for component in components:
            record_movement(component.article, depot, Kind.DISASSEMBLY_IN, component.quantity * quantity,
                            unit_cost=component.article.avg_cost, **common)
    refresh_alerts([kit_article] + [stock_target(c.article, 1)[0] for c in components
                                    if stock_target(c.article, 1)[0] is not None])
    return assembly


@transaction.atomic
def rebuild_stock_levels():
    """Reconstruit tous les niveaux à partir du journal (contrôle de cohérence / réparation)."""
    totals = {}
    for row in (StockMovement.objects.values("article_id", "depot_id", "kind")
                .annotate(total=Sum("quantity"))):
        key = (row["article_id"], row["depot_id"])
        entry = totals.setdefault(key, [0, 0])
        if row["kind"] in StockMovement.RESERVATION_KINDS:
            entry[1] += row["total"]
        else:
            entry[0] += row["total"]
    changed = 0
    for level in StockLevel.all_objects.select_for_update():
        quantity, reserved = totals.pop((level.article_id, level.depot_id), (0, 0))
        if level.quantity != quantity or level.reserved != reserved:
            level.quantity, level.reserved = quantity, reserved
            level.save(update_fields=["quantity", "reserved"])
            changed += 1
    for (article_id, depot_id), (quantity, reserved) in totals.items():
        StockLevel.objects.create(article_id=article_id, depot_id=depot_id, quantity=quantity, reserved=reserved)
        changed += 1
    return changed


def articles_below_threshold():
    """Articles suivis en stock dont le disponible global est sous le seuil (pour le tableau de bord)."""
    return StockAlert.objects.filter(resolved_at__isnull=True).select_related("article")


def depot_valuation(depot=None):
    levels = StockLevel.objects.filter(~Q(quantity=0)).select_related("article")
    if depot is not None:
        levels = levels.filter(depot=depot)
    return sum(max(level.quantity, 0) * int(level.article.avg_cost) for level in levels)
