"""Cycle de vie des commandes en ligne.

REÇUE → CONFIRMÉE → EN PRÉPARATION → PRÊTE → RETIRÉE, avec les branches ANNULÉE et EXPIRÉE.

- La confirmation **réserve** le stock du point de retrait (mouvements RESERVATION, kits virtuels
  décomposés, lots convertis) ; toute modification des lignes ajuste la réservation ; l'annulation,
  l'expiration ou le retrait la **libèrent** (RESERVATION_RELEASE). La réservation d'une commande se
  calcule toujours comme la somme de ses mouvements : `sync_reservation` est donc idempotente.
- Une rupture constatée à la préparation donne lieu à une proposition au client (quantité réduite,
  article de substitution) ; si le client a accepté par avance une commande partielle, les
  réductions de quantité s'appliquent d'office.
- Le retrait se fait à la caisse : la commande devient une vente (canal « en ligne ») avec reçu.
"""
import math
import re
from collections import defaultdict
from datetime import timedelta

from django.db import transaction
from django.db.models import Sum
from django.dispatch import Signal
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.catalog.models import Article
from apps.catalog.services import article_availability
from apps.core.numbering import next_document_number
from apps.customers.models import Customer
from apps.settings_app.models import LibrarySettings
from apps.stock.models import Depot, StockLevel, StockMovement
from apps.stock.services import record_movement, stock_lookup, stock_target

from .models import OnlineOrder, OnlineOrderLine, OrderStatusHistory, PaymentTransaction
from .payments import OPERATORS, get_provider

Status = OnlineOrder.Status

# Événement métier émis à chaque étape (les notifications s'y abonnent) :
# kwargs `order`, `event` (placed, confirmed, preparing, approval_requested, ready, picked_up,
# cancelled, expired, reminder, deposit_paid) et `user`.
order_event = Signal()

MAX_LINE_QTY = 999
QR_RE = re.compile(r"^CMD:(?P<number>[A-Z0-9-]+):(?P<code>\d{6})$")


# --- Points de retrait et disponibilité ------------------------------------------------------


def pickup_points():
    depots = Depot.objects.filter(is_active=True, is_pickup_point=True)
    if not depots.exists():
        depots = Depot.objects.filter(is_active=True, is_default=True)
    return depots


def availability_status(article: Article, available) -> str:
    """Libellé de disponibilité affiché en boutique : IN_STOCK, LOW ou OUT."""
    if available is None:
        return "IN_STOCK"
    if available <= 0:
        return "OUT"
    if available <= max(article.alert_threshold, 2):
        return "LOW"
    return "IN_STOCK"


def customer_for_user(user) -> Customer:
    """Fiche client liée au compte boutique (rapprochée par téléphone, sinon créée)."""
    customer = Customer.objects.filter(user=user).first()
    if customer:
        return customer
    if user.phone:
        customer = Customer.objects.filter(phone=user.phone, user__isnull=True).first()
        if customer:
            customer.user = user
            customer.save(update_fields=["user", "updated_at"])
            return customer
    return Customer.objects.create(name=user.get_full_name() or user.username, phone=user.phone or "",
                                   email=user.email or "", user=user)


# --- Réservation -------------------------------------------------------------------------------


def reservation_targets(order: OnlineOrder) -> dict:
    """Quantités à réserver par article réellement stocké (kits virtuels et lots décomposés)."""
    from apps.sales.services import stock_effects

    targets = defaultdict(int)
    articles = {}
    for line in order.lines.select_related("article", "article__kit"):
        if line.quantity <= 0:
            continue
        for article, quantity in stock_effects(line.article, line.quantity):
            target, target_qty = stock_target(article, quantity)
            if target is not None and target_qty:
                targets[target.pk] += target_qty
                articles[target.pk] = target
    return {pk: (articles[pk], qty) for pk, qty in targets.items()}


def current_reservation(order: OnlineOrder) -> dict:
    rows = (StockMovement.objects.filter(source_type="OnlineOrder", source_id=str(order.pk),
                                         kind__in=StockMovement.RESERVATION_KINDS)
            .values("article_id").annotate(total=Sum("quantity")))
    return {row["article_id"]: row["total"] for row in rows if row["total"]}


@transaction.atomic
def sync_reservation(order: OnlineOrder, user=None, strict=False):
    """Aligne la réservation sur les lignes (ou la libère si la commande n'est plus en cours).

    Avec `strict=True`, une réservation supérieure au disponible est refusée (confirmation).
    """
    desired = reservation_targets(order) if order.status in OnlineOrder.RESERVING else {}
    current = current_reservation(order)
    for article_id in set(desired) | set(current):
        article, wanted = desired.get(article_id, (None, 0))
        delta = wanted - current.get(article_id, 0)
        if not delta:
            continue
        if article is None:
            article = Article.objects.get(pk=article_id)
        kind = StockMovement.Kind.RESERVATION if delta > 0 else StockMovement.Kind.RESERVATION_RELEASE
        record_movement(article, order.pickup_depot, kind, delta, user=user, reference=order.number,
                        source_type="OnlineOrder", source_id=order.pk, convert=False,
                        allow_negative=not strict or delta < 0,
                        reason=f"Commande en ligne {order.number}")


# --- Historique et transitions -----------------------------------------------------------------


def _transition(order: OnlineOrder, to_status, user=None, note="", event=None):
    from_status = order.status
    if to_status not in OnlineOrder.TRANSITIONS.get(from_status, ()):
        raise ValidationError({"status": f"Passage impossible de « {order.get_status_display()} » à "
                                         f"« {Status(to_status).label} »."})
    order.status = to_status
    order.save()
    OrderStatusHistory.objects.create(order=order, from_status=from_status, to_status=to_status, note=note[:255],
                                      user=user)
    log_event(AuditLog.Action.CANCEL if to_status == Status.CANCELLED else AuditLog.Action.UPDATE,
              user=user, entity="OnlineOrder", entity_id=order.pk,
              description=f"Commande {order.number} : {Status(from_status).label} → {Status(to_status).label}"
                          + (f" ({note})" if note else ""))
    if event:
        transaction.on_commit(lambda: order_event.send(sender=OnlineOrder, order=order, event=event, user=user))


def _notify(order, event, user=None):
    transaction.on_commit(lambda: order_event.send(sender=OnlineOrder, order=order, event=event, user=user))


def recompute_total(order: OnlineOrder):
    order.total = sum(line.line_total for line in order.lines.all())
    order.save(update_fields=["total", "updated_at", "sync_version"])


# --- Création (boutique) -----------------------------------------------------------------------


def _int(value, field, minimum=0, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError({field: "Valeur numérique attendue."})
    if number < minimum or (maximum is not None and number > maximum):
        raise ValidationError({field: "Valeur hors limites."})
    return number


@transaction.atomic
def place_order(user, data) -> OnlineOrder:
    from apps.sales.services import catalog_unit_price

    depot = pickup_points().filter(pk=data.get("pickup_depot")).first() if data.get("pickup_depot") else \
        pickup_points().first()
    if depot is None:
        raise ValidationError({"pickup_depot": "Point de retrait inconnu."})
    raw_lines = data.get("lines") or []
    if not raw_lines:
        raise ValidationError({"lines": "Votre panier est vide."})
    quantities = defaultdict(int)
    for item in raw_lines:
        quantities[str(item.get("article"))] += _int(item.get("quantity"), "quantity", 1, MAX_LINE_QTY)
    articles = {str(a.pk): a for a in Article.objects.select_related("kit").filter(
        pk__in=list(quantities), is_active=True, is_online=True)}
    missing = set(quantities) - set(articles)
    if missing:
        raise ValidationError({"lines": "Certains articles ne sont plus proposés en ligne : actualisez votre panier."})

    stock_of = stock_lookup(depot)
    now = timezone.now()
    lines, total, problems = [], 0, []
    for index, (article_id, quantity) in enumerate(quantities.items()):
        article = articles[article_id]
        available = article_availability(article, stock_of)
        if available is not None and available < quantity:
            problems.append(f"{article.name} : {max(available, 0)} disponible(s)")
        unit_price, _kind = catalog_unit_price(article, quantity, now)
        lines.append(OnlineOrderLine(article=article, description=article.name[:200], ordered_qty=quantity,
                                     quantity=quantity, unit_price=unit_price, line_total=unit_price * quantity,
                                     sort_order=index))
        total += unit_price * quantity
    if problems:
        raise ValidationError({"lines": "Stock insuffisant — " + " ; ".join(problems)})

    settings = LibrarySettings.load()
    payment_mode = data.get("payment_mode") or OnlineOrder.PaymentMode.ON_PICKUP
    if payment_mode not in OnlineOrder.PaymentMode.values:
        raise ValidationError({"payment_mode": "Mode de paiement inconnu."})
    deposit_due = 0
    if payment_mode == OnlineOrder.PaymentMode.DEPOSIT:
        if not settings.online_deposit_percent:
            raise ValidationError({"payment_mode": "Le paiement d'un acompte en ligne n'est pas proposé."})
        deposit_due = math.ceil(total * settings.online_deposit_percent / 100)

    slot = data.get("pickup_slot") or None
    if slot is not None and slot < now - timedelta(minutes=5):
        raise ValidationError({"pickup_slot": "Le créneau de retrait doit être dans le futur."})
    order = OnlineOrder.objects.create(
        number=next_document_number("CMD"), customer=customer_for_user(user), pickup_depot=depot,
        pickup_slot=slot, comment=(data.get("comment") or "")[:1000],
        accept_partial=bool(data.get("accept_partial")), payment_mode=payment_mode, total=total,
        deposit_due=deposit_due,
    )
    for line in lines:
        line.order = order
        line.save()
    OrderStatusHistory.objects.create(order=order, to_status=Status.RECEIVED, user=user, note="Commande passée en ligne")
    log_event(AuditLog.Action.CREATE, user=user, entity="OnlineOrder", entity_id=order.pk,
              description=f"Commande en ligne {order.number} : {total} FCFA")
    _notify(order, "placed", user)
    return order


# --- Étapes côté librairie ---------------------------------------------------------------------


@transaction.atomic
def confirm(order: OnlineOrder, user) -> OnlineOrder:
    order = OnlineOrder.objects.select_for_update().get(pk=order.pk)
    _transition(order, Status.CONFIRMED, user, event="confirmed")
    order.confirmed_at = timezone.now()
    order.save(update_fields=["confirmed_at", "updated_at", "sync_version"])
    try:
        sync_reservation(order, user, strict=True)
    except ValidationError as exc:
        raise ValidationError({"stock": f"Réservation impossible : {_first_message(exc)} Proposez une "
                                        "modification au client ou annulez la commande."})
    return order


def _first_message(exc):
    detail = exc.detail
    while isinstance(detail, (dict, list)):
        detail = next(iter(detail.values())) if isinstance(detail, dict) else detail[0]
    return str(detail)


@transaction.atomic
def start_preparation(order: OnlineOrder, user, preparer=None) -> OnlineOrder:
    order = OnlineOrder.objects.select_for_update().get(pk=order.pk)
    if order.status == Status.PREPARING:
        order.preparer = preparer or user
        order.save(update_fields=["preparer", "updated_at", "sync_version"])
        return order
    order.preparer = preparer or user
    _transition(order, Status.PREPARING, user, note=f"Préparateur : {order.preparer.get_full_name()}",
                event="preparing")
    return order


def _apply_proposals(order: OnlineOrder):
    """Applique les modifications proposées (quantités réduites, substitutions)."""
    from apps.sales.services import catalog_unit_price

    next_order = order.lines.count()
    for line in order.lines.exclude(proposal={}):
        proposal = line.proposal
        quantity = int(proposal.get("quantity", line.quantity))
        missing = line.quantity - quantity
        line.quantity = quantity
        line.line_total = line.unit_price * quantity
        line.prepared_qty = min(line.prepared_qty, quantity)
        line.status = OnlineOrderLine.Status.UNAVAILABLE if quantity == 0 else OnlineOrderLine.Status.PARTIAL
        line.proposal = {}
        line.save()
        if proposal.get("substitute") and missing > 0:
            substitute = Article.objects.get(pk=proposal["substitute"])
            unit_price, _kind = catalog_unit_price(substitute, missing, timezone.now())
            OnlineOrderLine.objects.create(
                order=order, article=substitute, original_article=line.article,
                description=f"{substitute.name} (remplace {line.article.name})"[:200], ordered_qty=missing,
                quantity=missing, unit_price=unit_price, line_total=unit_price * missing,
                status=OnlineOrderLine.Status.SUBSTITUTED, sort_order=next_order)
            next_order += 1
    recompute_total(order)


def _fully_prepared(order: OnlineOrder) -> bool:
    return all(line.prepared_qty >= line.quantity for line in order.lines.all())


def _mark_ready(order: OnlineOrder, user):
    if not order.lines.filter(quantity__gt=0).exists():
        raise ValidationError({"lines": "Plus aucun article disponible : annulez la commande."})
    _transition(order, Status.READY, user, event="ready")
    now = timezone.now()
    order.ready_at = now
    order.expires_at = now + timedelta(hours=LibrarySettings.load().order_expiry_hours)
    order.save(update_fields=["ready_at", "expires_at", "updated_at", "sync_version"])


@transaction.atomic
def prepare(order: OnlineOrder, user, *, lines=(), shortages=(), ready=False, parcels=None) -> OnlineOrder:
    """Enregistre la préparation (quantités scannées, ruptures) et, si demandé, passe la commande « prête ».

    Utilisé en ligne (API) et par la synchronisation (préparation faite hors ligne).
    """
    order = OnlineOrder.objects.select_for_update().get(pk=order.pk)
    if order.status == Status.CONFIRMED:
        start_preparation(order, user)
        order.refresh_from_db()
    if order.status != Status.PREPARING:
        raise ValidationError({"status": f"La commande {order.number} n'est pas en préparation "
                                         f"({order.get_status_display()})."})
    if order.awaiting_customer and (lines or shortages):
        raise ValidationError({"status": "La commande attend la réponse du client à la modification proposée."})
    by_id = {str(line.pk): line for line in order.lines.select_related("article")}
    for item in lines:
        line = by_id.get(str(item.get("line")))
        if line is None:
            raise ValidationError({"lines": "Ligne inconnue pour cette commande."})
        prepared = _int(item.get("prepared_qty"), "prepared_qty", 0, MAX_LINE_QTY)
        if prepared > line.quantity:
            raise ValidationError({"lines": f"{line.description} : {prepared} préparé(s) pour {line.quantity} "
                                            "commandé(s)."})
        line.prepared_qty = prepared
        line.save(update_fields=["prepared_qty", "updated_at", "sync_version"])
    for item in shortages:
        line = by_id.get(str(item.get("line")))
        if line is None:
            raise ValidationError({"shortages": "Ligne inconnue pour cette commande."})
        quantity = _int(item.get("quantity"), "quantity", 0, MAX_LINE_QTY)
        if quantity >= line.quantity:
            raise ValidationError({"shortages": f"{line.description} : la quantité disponible doit être "
                                                "inférieure à la quantité commandée."})
        proposal = {"quantity": quantity}
        if item.get("substitute"):
            substitute = Article.objects.filter(pk=item["substitute"], is_active=True).first()
            if substitute is None or substitute.pk == line.article_id:
                raise ValidationError({"shortages": "Article de substitution invalide."})
            from apps.sales.services import catalog_unit_price

            price, _kind = catalog_unit_price(substitute, line.quantity - quantity, timezone.now())
            proposal.update({"substitute": str(substitute.pk), "substitute_name": substitute.name,
                             "substitute_quantity": line.quantity - quantity, "unit_price": price})
        line.proposal = proposal
        line.save(update_fields=["proposal", "updated_at", "sync_version"])
    if parcels:
        order.parcels = _int(parcels, "parcels", 1, 99)
    order.save()

    if ready:
        pending = order.lines.exclude(proposal={})
        if pending.exists():
            only_reductions = not any(line.proposal.get("substitute") for line in pending)
            if order.accept_partial and only_reductions:
                _apply_proposals(order)
                sync_reservation(order, user)
                OrderStatusHistory.objects.create(order=order, from_status=order.status, to_status=order.status,
                                                  user=user, note="Commande partielle (accord préalable du client)")
            else:
                order.awaiting_customer = True
                order.save(update_fields=["awaiting_customer", "updated_at", "sync_version"])
                OrderStatusHistory.objects.create(order=order, from_status=order.status, to_status=order.status,
                                                  user=user, note="Modification proposée au client")
                _notify(order, "approval_requested", user)
                return order
        if not _fully_prepared(order):
            raise ValidationError({"lines": "Préparation incomplète : scannez tous les articles ou signalez "
                                            "les ruptures."})
        _mark_ready(order, user)
    return order


@transaction.atomic
def answer_proposal(order: OnlineOrder, user, accept: bool) -> OnlineOrder:
    """Réponse du client à une modification proposée (rupture, substitution)."""
    order = OnlineOrder.objects.select_for_update().get(pk=order.pk)
    if not order.awaiting_customer:
        raise ValidationError({"status": "Aucune modification n'attend votre accord."})
    if not accept:
        order.awaiting_customer = False
        order.save(update_fields=["awaiting_customer"])
        return cancel(order, user, "Modification refusée par le client", by_customer=True, force=True)
    _apply_proposals(order)
    order.awaiting_customer = False
    order.save(update_fields=["awaiting_customer", "updated_at", "sync_version"])
    sync_reservation(order, user)
    OrderStatusHistory.objects.create(order=order, from_status=order.status, to_status=order.status, user=user,
                                      note="Modification acceptée par le client")
    if _fully_prepared(order):
        _mark_ready(order, user)
    return order


@transaction.atomic
def cancel(order: OnlineOrder, user, reason="", *, by_customer=False, force=False) -> OnlineOrder:
    order = OnlineOrder.objects.select_for_update().get(pk=order.pk)
    if by_customer and not force and order.status not in OnlineOrder.CUSTOMER_CANCELLABLE:
        raise ValidationError({"status": "La commande est déjà en préparation : contactez la librairie."})
    if not by_customer and not reason.strip():
        raise ValidationError({"reason": "Indiquez le motif de l'annulation."})
    _transition(order, Status.CANCELLED, user, note=reason or "Annulée par le client", event="cancelled")
    order.cancelled_at = timezone.now()
    order.cancel_reason = (reason or "Annulée par le client")[:255]
    order.awaiting_customer = False
    order.save(update_fields=["cancelled_at", "cancel_reason", "awaiting_customer", "updated_at", "sync_version"])
    sync_reservation(order, user)
    return order


def expire_due(now=None) -> int:
    """Commandes prêtes non retirées dans le délai : EXPIRÉE et stock libéré (tâche Celery)."""
    now = now or timezone.now()
    count = 0
    for order in OnlineOrder.objects.filter(status=Status.READY, expires_at__lte=now):
        with transaction.atomic():
            locked = OnlineOrder.objects.select_for_update().get(pk=order.pk)
            if locked.status != Status.READY:
                continue
            _transition(locked, Status.EXPIRED, None, note="Délai de retrait dépassé", event="expired")
            sync_reservation(locked)
            count += 1
    return count


def remind_due(now=None, before=timedelta(hours=12)) -> int:
    """Rappel au client (et au personnel) d'une commande prête qui va expirer."""
    now = now or timezone.now()
    count = 0
    for order in OnlineOrder.objects.filter(status=Status.READY, reminder_sent_at__isnull=True,
                                            expires_at__gt=now, expires_at__lte=now + before):
        OnlineOrder.all_objects.filter(pk=order.pk).update(reminder_sent_at=now)
        order_event.send(sender=OnlineOrder, order=order, event="reminder", user=None)
        count += 1
    return count


# --- Retrait (caisse) -------------------------------------------------------------------------


def lookup(code: str):
    """Commande à retirer à partir du QR code (`CMD:numéro:code`), du code à 6 chiffres ou du numéro."""
    code = (code or "").strip().upper()
    match = QR_RE.match(code)
    queryset = OnlineOrder.objects.select_related("customer", "pickup_depot")
    if match:
        return queryset.filter(number=match["number"], pickup_code=match["code"]).first()
    if re.fullmatch(r"\d{6}", code):
        found = list(queryset.filter(pickup_code=code, status=Status.READY)[:2])
        if len(found) > 1:
            raise ValidationError({"code": "Plusieurs commandes ont ce code : saisissez le numéro de commande."})
        return found[0] if found else None
    return queryset.filter(number=code).first()


def order_for_sale(payload, depot):
    """Commande retirée par une vente (contrôlée avant l'enregistrement de la vente)."""
    order = OnlineOrder.objects.select_for_update().filter(pk=payload["online_order"]).first()
    if order is None:
        raise ValidationError({"online_order": "Commande en ligne inconnue."})
    if order.status != Status.READY:
        raise ValidationError({"online_order": f"La commande {order.number} n'est pas prête au retrait "
                                               f"({order.get_status_display()})."})
    if order.pickup_depot_id != depot.pk:
        raise ValidationError({"online_order": f"La commande {order.number} se retire à {order.pickup_depot.name}."})
    return order


def complete_pickup(order: OnlineOrder, sale, user):
    order.sale = sale
    order.picked_up_at = sale.sold_at
    _transition(order, Status.PICKED_UP, user, note=f"Vente {sale.receipt_number}", event="picked_up")
    sync_reservation(order, user)


# --- Acompte en ligne --------------------------------------------------------------------------


@transaction.atomic
def initiate_deposit(order: OnlineOrder, user, phone: str, operator: str):
    if order.payment_mode != OnlineOrder.PaymentMode.DEPOSIT or order.deposit_paid >= order.deposit_due:
        raise ValidationError({"payment": "Aucun acompte n'est à régler pour cette commande."})
    if order.status not in OnlineOrder.OPEN:
        raise ValidationError({"payment": "Commande clôturée."})
    if operator not in OPERATORS:
        raise ValidationError({"operator": "Opérateur Mobile Money inconnu."})
    if not re.fullmatch(r"\+?\d{8,15}", (phone or "").replace(" ", "")):
        raise ValidationError({"phone": "Numéro de téléphone invalide."})
    provider = get_provider()
    amount = order.deposit_due - order.deposit_paid
    result = provider.initiate(order=order, amount=amount, phone=phone, operator=operator)
    transaction_ = PaymentTransaction.objects.create(
        order=order, provider=provider.code, operator=operator, phone=phone.replace(" ", ""), amount=amount,
        external_ref=result.external_ref, message=result.instructions[:255], raw=result.raw or {})
    return transaction_, result


@transaction.atomic
def settle_payment(external_ref: str, succeeded: bool, message="", raw=None) -> PaymentTransaction:
    """Résultat d'un paiement (webhook du prestataire) ; idempotent."""
    payment = PaymentTransaction.objects.select_for_update().filter(external_ref=external_ref).first()
    if payment is None:
        raise ValidationError({"reference": "Transaction inconnue."})
    if payment.status != PaymentTransaction.Status.PENDING:
        return payment
    payment.status = PaymentTransaction.Status.SUCCEEDED if succeeded else PaymentTransaction.Status.FAILED
    payment.message = (message or ("Paiement reçu" if succeeded else "Paiement refusé"))[:255]
    payment.raw = raw or payment.raw
    payment.completed_at = timezone.now()
    payment.save()
    if succeeded:
        order = OnlineOrder.objects.select_for_update().get(pk=payment.order_id)
        order.deposit_paid += payment.amount
        order.save(update_fields=["deposit_paid", "updated_at", "sync_version"])
        OrderStatusHistory.objects.create(order=order, from_status=order.status, to_status=order.status,
                                          note=f"Acompte reçu : {payment.amount} FCFA ({payment.external_ref})")
        log_event(AuditLog.Action.UPDATE, entity="OnlineOrder", entity_id=order.pk,
                  description=f"Acompte {payment.amount} FCFA reçu pour {order.number} ({payment.provider})")
        _notify(order, "deposit_paid")
    return payment


def picking_list(order: OnlineOrder) -> list:
    """Lignes de préparation triées par emplacement du point de retrait (puis par libellé)."""
    from apps.sales.services import stock_effects

    locations = {level.article_id: level.location for level in StockLevel.objects.select_related("location").filter(
        depot=order.pickup_depot, article__in=[line.article_id for line in order.lines.all()])}
    rows = []
    for line in order.lines.select_related("article", "article__kit"):
        location = locations.get(line.article_id)
        components = []
        if line.article.type == Article.Type.KIT:
            components = [{"name": a.name, "code": a.code, "quantity": q}
                          for a, q in stock_effects(line.article, line.quantity)]
        rows.append({
            "line": str(line.pk), "article": str(line.article_id), "code": line.article.code,
            "name": line.description, "quantity": line.quantity, "prepared_qty": line.prepared_qty,
            "location": location.code if location else "", "location_order": location.sort_order if location else 9999,
            "barcodes": list(line.article.barcodes.values_list("code", flat=True)), "components": components,
        })
    rows.sort(key=lambda row: (row["location_order"], row["location"] or "~", row["name"]))
    return rows
