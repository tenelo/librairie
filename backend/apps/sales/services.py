"""Règles serveur des ventes, retours, caisses et comptes clients.

Toutes les écritures arrivent par la synchronisation (`sync/push`), qu'elles aient été faites en
ligne ou hors ligne : un seul chemin, donc les mêmes contrôles. Le serveur recalcule les montants
et rejette toute incohérence arithmétique ; un prix différent du catalogue (prix modifié pendant
que le terminal était hors ligne) est accepté s'il correspond au prix en vigueur à l'heure de la
vente, sinon accepté mais signalé dans le journal d'audit.
"""
import re
from collections import Counter
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.catalog.models import Article, Kit
from apps.catalog.services import customize_kit
from apps.core.money import to_fcfa
from apps.customers.models import Customer
from apps.settings_app.models import LibrarySettings
from apps.stock.models import Depot, StockMovement
from apps.stock.services import record_movement, refresh_alerts

from .models import (
    CashMovement,
    CashSession,
    CreditNote,
    CustomerAccountEntry,
    LoyaltyEntry,
    Payment,
    PaymentMethod,
    Sale,
    SaleLine,
    SaleReturn,
    SaleReturnLine,
    Voucher,
)

RECEIPT_RE = re.compile(r"^(?P<device>[A-Z0-9]{2,10})-(?P<date>\d{8})-(?P<seq>\d{4,6})$")


def _origin(context):
    return AuditLog.Origin.SYNC if context.client_timestamp else AuditLog.Origin.ONLINE


def _int(value, field):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError({field: "Montant ou quantité invalide."})
    return number


# --- Prix en vigueur ---------------------------------------------------------------------------


def price_at(article: Article, field: str, when) -> int | None:
    """Valeur d'un prix à une date donnée, reconstituée à partir de l'historique des prix."""
    change = article.price_history.filter(field=field, changed_at__gt=when).order_by("changed_at").first()
    raw = change.old_value if change else getattr(article, field)
    if raw in (None, ""):
        return None
    return int(Decimal(str(raw)))


def catalog_unit_price(article: Article, quantity: int, when) -> tuple[int, str]:
    """Prix catalogue applicable (détail, ou gros au-delà du seuil) à la date de la vente."""
    wholesale = price_at(article, "wholesale_price", when)
    threshold = price_at(article, "wholesale_min_qty", when)
    if wholesale is not None and threshold and quantity >= threshold:
        return wholesale, SaleLine.PriceKind.WHOLESALE
    return price_at(article, "retail_price", when) or 0, SaleLine.PriceKind.RETAIL


# --- Stock -------------------------------------------------------------------------------------


def stock_effects(article: Article, quantity: int, adjustments: dict | None = None):
    """Articles réellement sortis du stock pour `quantity` unités vendues (kits virtuels décomposés)."""
    if article.type == Article.Type.KIT and article.kit.stock_mode == Kit.StockMode.VIRTUAL:
        adjustments = adjustments or {}
        removed = {str(r) for r in adjustments.get("removed", [])}
        substitutions = {str(k): str(v) for k, v in (adjustments.get("substitutions") or {}).items()}
        effects = []
        for component in article.kit.components.select_related("article"):
            key = str(component.pk)
            if key in removed:
                continue
            target = component.article
            if key in substitutions:
                target = Article.objects.get(pk=substitutions[key])
            effects.append((target, component.quantity * quantity))
        return effects
    return [(article, quantity)]


def _move_stock(effects, depot, kind, sign, *, context, reference, source_type, source_id, occurred_at):
    touched = []
    for article, quantity in effects:
        movement = record_movement(article, depot, kind, sign * quantity, unit_cost=article.avg_cost,
                                   user=context.user, reference=reference, source_type=source_type,
                                   source_id=source_id, device=context.device,
                                   client_timestamp=context.client_timestamp, occurred_at=occurred_at)
        if movement is not None:
            touched.append(movement.article)
    return touched


# --- Comptes clients ---------------------------------------------------------------------------


def customer_balance(customer: Customer) -> int:
    return customer.account_entries.aggregate(total=Sum("amount"))["total"] or 0


def loyalty_balance(customer: Customer) -> int:
    return customer.loyalty_entries.aggregate(total=Sum("points"))["total"] or 0


def touch_customer(customer: Customer):
    """Nouvelle version du client : son solde et ses points à jour redescendent vers les terminaux."""
    customer.save(update_fields=["updated_at"])


# --- Caisse ------------------------------------------------------------------------------------


def open_session(context, payload):
    if context.device is None:
        raise ValidationError({"device": "Terminal non enregistré : ouverture de caisse impossible."})
    existing = CashSession.all_objects.filter(pk=payload["id"]).first()
    if existing:
        return existing
    if CashSession.objects.filter(device=context.device, status=CashSession.Status.OPEN).exists():
        raise ValidationError({"session": "Une caisse est déjà ouverte sur ce terminal."})
    session = CashSession.objects.create(
        id=payload["id"], device=context.device, depot=Depot.objects.get(pk=payload["depot"]),
        opened_by=context.user, opened_at=context.client_timestamp or timezone.now(),
        opening_float=_int(payload.get("opening_float", 0), "opening_float"),
        client_timestamp=context.client_timestamp, notes=payload.get("notes", ""),
    )
    log_event(AuditLog.Action.DRAWER_OPEN, user=context.user, device=context.device, entity="CashSession",
              entity_id=session.pk, description=f"Ouverture de caisse (fond {session.opening_float} FCFA)",
              client_timestamp=context.client_timestamp, origin=_origin(context))
    return session


def cash_movement(context, payload):
    session = CashSession.objects.get(pk=payload["session"])
    if session.status != CashSession.Status.OPEN:
        raise ValidationError({"session": "La caisse est clôturée."})
    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "La justification est obligatoire."})
    movement = CashMovement.objects.create(id=payload["id"], session=session, kind=payload["kind"],
                                           amount=_int(payload["amount"], "amount"), reason=reason,
                                           user=context.user, occurred_at=context.client_timestamp or timezone.now(),
                                           device=context.device, client_timestamp=context.client_timestamp)
    log_event(AuditLog.Action.DRAWER_OPEN, user=context.user, device=context.device, entity="CashMovement",
              entity_id=movement.pk, description=f"{movement.get_kind_display()} {movement.amount} FCFA : {reason}",
              client_timestamp=context.client_timestamp, origin=_origin(context))
    return movement


def expected_cash(session: CashSession) -> int:
    """Espèces attendues = fond + encaissements espèces − monnaie rendue − remboursements espèces
    + règlements de crédit en espèces + entrées − sorties."""
    cash = PaymentMethod.Kind.CASH
    payments = Payment.objects.filter(sale__cash_session=session, sale__status=Sale.Status.COMPLETED,
                                      method__kind=cash).aggregate(t=Sum("amount"))["t"] or 0
    change = session.sales.filter(status=Sale.Status.COMPLETED).aggregate(t=Sum("change_due"))["t"] or 0
    refunds = session.returns.filter(refund_mode=SaleReturn.RefundMode.CASH).aggregate(t=Sum("total"))["t"] or 0
    repayments = -(session.repayments.filter(method__kind=cash).aggregate(t=Sum("amount"))["t"] or 0)
    ins = session.movements.filter(kind=CashMovement.Kind.IN).aggregate(t=Sum("amount"))["t"] or 0
    outs = session.movements.filter(kind=CashMovement.Kind.OUT).aggregate(t=Sum("amount"))["t"] or 0
    return session.opening_float + payments - change - refunds + repayments + ins - outs


def close_session(context, payload):
    session = CashSession.objects.get(pk=payload["session"])
    if session.status == CashSession.Status.CLOSED:
        return session
    counted = _int(payload["counted_cash"], "counted_cash")
    denominations = payload.get("denominations") or {}
    from_denominations = sum(int(value) * int(count) for value, count in denominations.items())
    if denominations and from_denominations != counted:
        raise ValidationError({"counted_cash": "Le total ne correspond pas au détail des billets et pièces."})
    session.expected_cash = expected_cash(session)
    session.counted_cash = counted
    session.variance = counted - session.expected_cash
    session.denominations = denominations
    session.status = CashSession.Status.CLOSED
    session.closed_by = context.user
    session.closed_at = context.client_timestamp or timezone.now()
    session.z_number = (payload.get("z_number") or "")[:40]
    session.notes = payload.get("notes", session.notes)
    session.save()
    log_event(AuditLog.Action.UPDATE, user=context.user, device=context.device, entity="CashSession",
              entity_id=session.pk, description=f"Clôture de caisse {session.z_number} : écart {session.variance} FCFA",
              new_values={"expected": session.expected_cash, "counted": counted, "variance": session.variance},
              client_timestamp=context.client_timestamp, origin=_origin(context))
    return session


def z_report(session: CashSession) -> dict:
    sales = session.sales.filter(status=Sale.Status.COMPLETED)
    by_method = {}
    for row in (Payment.objects.filter(sale__in=sales).values("method__code", "method__label")
                .annotate(total=Sum("amount")).order_by("method__label")):
        by_method[row["method__code"]] = {"label": row["method__label"], "total": row["total"]}
    receipts = list(sales.order_by("receipt_number").values_list("receipt_number", flat=True))
    returns = session.returns.all()
    return {
        "session": str(session.pk), "z_number": session.z_number, "device": session.device.code if session.device else None,
        "depot": session.depot.name, "opened_at": session.opened_at, "closed_at": session.closed_at,
        "opened_by": session.opened_by.get_full_name(),
        "closed_by": session.closed_by.get_full_name() if session.closed_by else None,
        "sales_count": sales.count(), "sales_total": sales.aggregate(t=Sum("total"))["t"] or 0,
        "discount_total": sales.aggregate(t=Sum("discount_total"))["t"] or 0,
        "returns_count": returns.count(), "returns_total": returns.aggregate(t=Sum("total"))["t"] or 0,
        "payments": by_method, "first_receipt": receipts[0] if receipts else None,
        "last_receipt": receipts[-1] if receipts else None,
        "cash_in": session.movements.filter(kind="IN").aggregate(t=Sum("amount"))["t"] or 0,
        "cash_out": session.movements.filter(kind="OUT").aggregate(t=Sum("amount"))["t"] or 0,
        "opening_float": session.opening_float,
        "expected_cash": session.expected_cash if session.status == "CLOSED" else expected_cash(session),
        "counted_cash": session.counted_cash, "variance": session.variance, "denominations": session.denominations,
    }


# --- Vente -------------------------------------------------------------------------------------


def _authorizer(username, permission, percent=None):
    user = User.objects.filter(username=username, is_active=True).first() if username else None
    if user is None or not user.has_app_perm(permission):
        return None
    if percent is not None and not user.is_superuser and (user.role is None or
                                                          user.role.max_discount_percent < percent):
        return None
    return user


def create_sale(context, payload) -> Sale:
    existing = Sale.all_objects.filter(pk=payload["id"]).first()
    if existing is not None:
        return existing
    if context.device is None:
        raise ValidationError({"device": "Vente refusée : terminal non enregistré."})
    number = str(payload.get("receipt_number", ""))
    match = RECEIPT_RE.match(number)
    if not match or match["device"] != context.device.code:
        raise ValidationError({"receipt_number": f"Numéro de reçu invalide pour le terminal {context.device.code}."})
    if Sale.all_objects.filter(receipt_number=number).exists():
        raise ValidationError({"receipt_number": f"Le numéro de reçu {number} est déjà utilisé."})

    sold_at = context.client_timestamp or timezone.now()
    depot = Depot.objects.get(pk=payload["depot"])
    session = None
    if payload.get("cash_session"):
        session = CashSession.objects.get(pk=payload["cash_session"])
        if session.device_id != context.device.pk:
            raise ValidationError({"cash_session": "La session de caisse appartient à un autre terminal."})
        if session.status == CashSession.Status.CLOSED and session.closed_at and session.closed_at < sold_at:
            raise ValidationError({"cash_session": "La caisse était clôturée au moment de la vente."})
    customer = Customer.objects.filter(pk=payload["customer"]).first() if payload.get("customer") else None
    if payload.get("customer") and customer is None:
        raise ValidationError({"customer": "Client inconnu."})
    # Retrait d'une commande en ligne : client et prix de la commande, acompte imputable.
    online_order, order_prices = None, {}
    if payload.get("online_order"):
        from apps.orders.services import order_for_sale

        online_order = order_for_sale(payload, depot)
        customer = online_order.customer
        order_prices = {str(line.article_id): line.unit_price for line in online_order.lines.all() if line.quantity}

    # 1. Lignes : contrôles arithmétiques et prix catalogue en vigueur.
    lines_data, price_flags, gross, subtotal, line_discounts = [], [], 0, 0, 0
    for index, line in enumerate(payload.get("lines") or []):
        article = Article.objects.select_related("kit").filter(pk=line["article"]).first()
        if article is None:
            raise ValidationError({"lines": f"Ligne {index + 1} : article inconnu."})
        quantity = _int(line["quantity"], "quantity")
        unit_price = _int(line["unit_price"], "unit_price")
        discount = _int(line.get("discount", 0), "discount")
        if quantity <= 0 or unit_price < 0 or discount < 0 or discount > quantity * unit_price:
            raise ValidationError({"lines": f"Ligne {index + 1} ({article.name}) : quantité, prix ou remise invalide."})
        line_total = quantity * unit_price - discount
        if _int(line.get("line_total", line_total), "line_total") != line_total:
            raise ValidationError({"lines": f"Ligne {index + 1} ({article.name}) : montant incohérent."})
        adjustments = line.get("kit_adjustments") or {}
        if article.type == Article.Type.KIT and (adjustments.get("removed") or adjustments.get("substitutions")):
            expected = customize_kit(article.kit, adjustments.get("removed", []), adjustments.get("substitutions", {}))
            expected_price, price_kind = expected.price, SaleLine.PriceKind.RETAIL
            trace = expected.adjustments
        else:
            expected_price, price_kind = catalog_unit_price(article, quantity, sold_at)
            trace = []
        if str(article.pk) in order_prices:
            expected_price, price_kind = order_prices[str(article.pk)], SaleLine.PriceKind.RETAIL
        if expected_price != unit_price:
            price_flags.append(f"{article.code} : {unit_price} au lieu de {expected_price}")
        gross += quantity * unit_price
        subtotal += line_total
        line_discounts += discount
        lines_data.append((article, quantity, unit_price, discount, line_total, price_kind, adjustments, trace,
                           line.get("description") or article.name, line.get("id")))
    if not lines_data:
        raise ValidationError({"lines": "La vente ne contient aucune ligne."})
    if online_order is not None:
        ordered, sold = Counter(), Counter()
        for order_line in online_order.lines.all():
            ordered[str(order_line.article_id)] += order_line.quantity
        for row in lines_data:
            sold[str(row[0].pk)] += row[1]
        if +ordered != +sold:
            raise ValidationError({"lines": f"Les articles ne correspondent pas à la commande {online_order.number}."})
    if _int(payload.get("subtotal", subtotal), "subtotal") != subtotal:
        raise ValidationError({"subtotal": "Le sous-total ne correspond pas aux lignes."})

    # 2. Remise globale, points de fidélité convertis et total.
    settings = LibrarySettings.load()
    global_discount = _int(payload.get("global_discount", 0), "global_discount")
    points_used = _int(payload.get("loyalty_points_used", 0), "loyalty_points_used")
    points_value = points_used * settings.loyalty_point_value
    if points_used:
        if customer is None or loyalty_balance(customer) < points_used:
            raise ValidationError({"loyalty_points_used": "Points de fidélité insuffisants."})
    total = subtotal - global_discount - points_value
    if global_discount < 0 or total < 0 or _int(payload.get("total"), "total") != total:
        raise ValidationError({"total": "Le total ne correspond pas aux lignes et aux remises."})

    # 3. Plafond de remise du rôle (hors points de fidélité) : au-delà, autorisation d'un responsable.
    discount_total = line_discounts + global_discount
    percent = (Decimal(discount_total) * 100 / gross) if gross else Decimal(0)
    cap = Decimal(context.user.role.max_discount_percent if context.user.role_id else 0)
    authorizer = None
    if percent > cap and not context.user.is_superuser:
        authorizer = _authorizer(payload.get("discount_authorized_by"), "sales.authorize", percent)
        if authorizer is None:
            raise ValidationError({"discount": f"Remise de {percent:.1f} % supérieure au plafond ({cap} %) "
                                               f"sans autorisation valide d'un responsable."})

    # 4. Paiements.
    payments_data, paid, cash_paid, deposit_used = [], 0, 0, 0
    for item in payload.get("payments") or []:
        method = PaymentMethod.objects.filter(code=item.get("method"), is_active=True).first()
        amount = _int(item.get("amount"), "amount")
        if method is None or amount <= 0:
            raise ValidationError({"payments": "Moyen de paiement ou montant invalide."})
        reference = (item.get("reference") or "").strip()
        if method.requires_reference and not reference:
            raise ValidationError({"payments": f"Référence de transaction obligatoire pour {method.label}."})
        voucher = credit_note = None
        if method.kind == PaymentMethod.Kind.VOUCHER:
            voucher = Voucher.objects.select_for_update().filter(code=item.get("voucher_code", ""), is_active=True).first()
            if voucher is None or voucher.remaining < amount or (voucher.expires_at and voucher.expires_at < sold_at.date()):
                raise ValidationError({"payments": "Bon d'achat invalide, expiré ou solde insuffisant."})
        if method.kind == PaymentMethod.Kind.CREDIT_NOTE:
            credit_note = CreditNote.objects.select_for_update().filter(number=item.get("credit_note_number", "")).first()
            if credit_note is None or credit_note.remaining < amount:
                raise ValidationError({"payments": "Avoir invalide ou solde insuffisant."})
        if method.kind == PaymentMethod.Kind.CREDIT and customer is None:
            raise ValidationError({"payments": "Une vente à crédit exige un client."})
        if method.kind == PaymentMethod.Kind.DEPOSIT:
            if online_order is None:
                raise ValidationError({"payments": "L'acompte en ligne ne s'impute que sur le retrait d'une commande."})
            deposit_used += amount
        if method.kind == PaymentMethod.Kind.CASH:
            cash_paid += amount
        paid += amount
        payments_data.append((method, amount, reference, voucher, credit_note))
    if online_order is not None and deposit_used > online_order.deposit_paid:
        raise ValidationError({"payments": f"Acompte imputé supérieur à l'acompte payé ({online_order.deposit_paid} FCFA)."})
    change = paid - total
    if change < 0:
        raise ValidationError({"payments": f"Paiement insuffisant : {paid} FCFA pour {total} FCFA."})
    if change > cash_paid:
        raise ValidationError({"payments": "La monnaie ne peut être rendue que sur un paiement en espèces."})
    if _int(payload.get("change_due", change), "change_due") != change:
        raise ValidationError({"change_due": "Monnaie rendue incohérente."})

    # 5. Enregistrement.
    sale = Sale.objects.create(
        id=payload["id"], receipt_number=number, customer=customer, cashier=context.user, device=context.device,
        depot=depot, cash_session=session, sold_at=sold_at, subtotal=subtotal, discount_total=discount_total,
        total=total, paid_total=paid, change_due=change, discount_authorized_by=authorizer,
        notes=(payload.get("notes") or "")[:255], client_timestamp=context.client_timestamp,
        channel=Sale.Channel.ONLINE if online_order else payload.get("channel", Sale.Channel.COUNTER),
    )
    touched = []
    for order, (article, quantity, unit_price, discount, line_total, price_kind, adjustments, trace, description,
                line_id) in enumerate(lines_data):
        line = SaleLine(sale=sale, article=article, description=description[:200], quantity=quantity,
                        unit_price=unit_price, price_kind=price_kind, discount=discount, line_total=line_total,
                        unit_cost=article.avg_cost, kit_adjustments=trace or adjustments or [], sort_order=order,
                        device=context.device)
        if line_id:
            line.id = line_id
        line.save()
        touched += _move_stock(stock_effects(article, quantity, adjustments), depot, StockMovement.Kind.SALE, -1,
                               context=context, reference=number, source_type="Sale", source_id=sale.pk,
                               occurred_at=sold_at)
    for method, amount, reference, voucher, credit_note in payments_data:
        Payment.objects.create(sale=sale, method=method, amount=amount, reference=reference, voucher=voucher,
                               credit_note=credit_note, device=context.device)
        if voucher:
            voucher.remaining -= amount
            voucher.save(update_fields=["remaining"])
        if credit_note:
            credit_note.remaining -= amount
            credit_note.save(update_fields=["remaining"])
        if method.kind == PaymentMethod.Kind.CREDIT:
            CustomerAccountEntry.objects.create(customer=customer, kind=CustomerAccountEntry.Kind.CREDIT_SALE,
                                                amount=amount, sale=sale, method=method, user=context.user)
            if customer_balance(customer) > customer.credit_limit:
                log_event(AuditLog.Action.UPDATE, user=context.user, device=context.device, entity="Customer",
                          entity_id=customer.pk, description=f"Plafond de crédit dépassé ({sale.receipt_number})",
                          client_timestamp=context.client_timestamp, origin=_origin(context))

    if customer is not None:
        if points_used:
            LoyaltyEntry.objects.create(customer=customer, points=-points_used, sale=sale,
                                        reason=f"Remise fidélité sur {number}")
        earned = (total // 1000) * settings.loyalty_points_per_1000
        if earned:
            LoyaltyEntry.objects.create(customer=customer, points=earned, sale=sale, reason=f"Achat {number}")
            sale.loyalty_points = earned
            sale.save(update_fields=["loyalty_points"])
        touch_customer(customer)

    if online_order is not None:
        from apps.orders.services import complete_pickup

        complete_pickup(online_order, sale, context.user)
    refresh_alerts({a.pk: a for a in touched}.values())
    log_event(AuditLog.Action.CREATE, user=context.user, device=context.device, entity="Sale", entity_id=sale.pk,
              description=f"Vente {number} : {total} FCFA", client_timestamp=context.client_timestamp,
              origin=_origin(context))
    if authorizer is not None:
        log_event(AuditLog.Action.DISCOUNT_OVERRIDE, user=context.user, device=context.device, entity="Sale",
                  entity_id=sale.pk, description=f"Remise de {percent:.1f} % autorisée par {authorizer.username}",
                  client_timestamp=context.client_timestamp, origin=_origin(context))
    if price_flags:
        log_event(AuditLog.Action.PRICE_CHANGE, user=context.user, device=context.device, entity="Sale",
                  entity_id=sale.pk, description=f"Prix hors catalogue sur {number} : " + "; ".join(price_flags)[:200],
                  client_timestamp=context.client_timestamp, origin=_origin(context))
    return sale


def reprint(context, payload):
    sale = Sale.objects.get(pk=payload["sale"])
    Sale.all_objects.filter(pk=sale.pk).update(reprint_count=sale.reprint_count + 1)
    sale.refresh_from_db()
    sale.save(update_fields=["reprint_count"])
    log_event(AuditLog.Action.REPRINT, user=context.user, device=context.device, entity="Sale", entity_id=sale.pk,
              description=f"Réimpression (DUPLICATA) du reçu {sale.receipt_number}",
              client_timestamp=context.client_timestamp, origin=_origin(context))
    return sale


# --- Retours -----------------------------------------------------------------------------------


def returnable_quantity(line: SaleLine) -> int:
    returned = line.return_lines.aggregate(total=Sum("quantity"))["total"] or 0
    return line.quantity - returned


def create_return(context, payload) -> SaleReturn:
    existing = SaleReturn.all_objects.filter(pk=payload["id"]).first()
    if existing is not None:
        return existing
    sale = Sale.objects.filter(pk=payload.get("sale")).first() or Sale.objects.filter(
        receipt_number=payload.get("receipt_number", "")).first()
    if sale is None:
        raise ValidationError({"sale": "Vente introuvable."})
    authorizer = _authorizer(payload.get("authorized_by"), "sales.authorize")
    if authorizer is None:
        raise ValidationError({"authorized_by": "Un retour exige l'autorisation d'un responsable."})
    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "Le motif du retour est obligatoire."})
    mode = payload.get("refund_mode", SaleReturn.RefundMode.CASH)
    session = CashSession.objects.filter(pk=payload.get("cash_session")).first() if payload.get("cash_session") else None
    if mode == SaleReturn.RefundMode.CASH and (session is None or session.status != CashSession.Status.OPEN):
        raise ValidationError({"cash_session": "Un remboursement en espèces exige une caisse ouverte."})

    ratio = Decimal(sale.total) / Decimal(sale.subtotal) if sale.subtotal else Decimal(1)
    items, total = [], 0
    for item in payload.get("lines") or []:
        line = SaleLine.objects.select_related("article").filter(pk=item["sale_line"], sale=sale).first()
        quantity = _int(item.get("quantity"), "quantity")
        if line is None or quantity <= 0:
            raise ValidationError({"lines": "Ligne de vente invalide."})
        if quantity > returnable_quantity(line):
            raise ValidationError({"lines": f"« {line.description} » : {returnable_quantity(line)} au plus à retourner."})
        # Montant au prorata de la ligne, remise globale de la vente répartie.
        amount = to_fcfa(Decimal(line.line_total) * quantity / line.quantity * ratio)
        items.append((line, quantity, amount))
        total += amount
    if not items:
        raise ValidationError({"lines": "Aucun article à retourner."})

    number = payload.get("number") or f"RET-{sale.receipt_number}-{sale.returns.count() + 1}"
    credit_note = None
    if mode == SaleReturn.RefundMode.CREDIT_NOTE:
        credit_note = CreditNote.objects.create(number=f"AV-{number}", customer=sale.customer, amount=total,
                                                remaining=total, device=context.device)
    sale_return = SaleReturn.objects.create(
        id=payload["id"], number=number, sale=sale, refund_mode=mode, total=total, reason=reason, user=context.user,
        authorized_by=authorizer, cash_session=session, credit_note=credit_note,
        returned_at=context.client_timestamp or timezone.now(), device=context.device,
        client_timestamp=context.client_timestamp,
    )
    touched = []
    for line, quantity, amount in items:
        SaleReturnLine.objects.create(sale_return=sale_return, sale_line=line, quantity=quantity, amount=amount)
        adjustments = {}
        if line.kit_adjustments:
            adjustments = {"removed": [a["component"] for a in line.kit_adjustments if a.get("action") == "REMOVED"],
                           "substitutions": {a["component"]: a["substitute"] for a in line.kit_adjustments
                                             if a.get("action") == "SUBSTITUTED"}}
        touched += _move_stock(stock_effects(line.article, quantity, adjustments), sale.depot,
                               StockMovement.Kind.CUSTOMER_RETURN, 1, context=context, reference=number,
                               source_type="SaleReturn", source_id=sale_return.pk,
                               occurred_at=sale_return.returned_at)
    if sale.customer_id and sale.loyalty_points and sale.total:
        lost = -int(sale.loyalty_points * total / sale.total)
        if lost:
            LoyaltyEntry.objects.create(customer=sale.customer, points=lost, sale=sale, reason=f"Retour {number}")
        touch_customer(sale.customer)
    refresh_alerts({a.pk: a for a in touched}.values())
    log_event(AuditLog.Action.REFUND, user=context.user, device=context.device, entity="SaleReturn",
              entity_id=sale_return.pk, description=f"Retour {number} sur {sale.receipt_number} : {total} FCFA "
                                                    f"({sale_return.get_refund_mode_display()}), autorisé par "
                                                    f"{authorizer.username}",
              client_timestamp=context.client_timestamp, origin=_origin(context))
    return sale_return


# --- Clients ------------------------------------------------------------------------------------


def repay(context, payload):
    customer = Customer.objects.get(pk=payload["customer"])
    amount = _int(payload["amount"], "amount")
    if amount <= 0:
        raise ValidationError({"amount": "Montant invalide."})
    method = PaymentMethod.objects.get(code=payload.get("method", "CASH"))
    session = CashSession.objects.filter(pk=payload.get("cash_session")).first() if payload.get("cash_session") else None
    entry = CustomerAccountEntry.objects.create(id=payload["id"], customer=customer,
                                                kind=CustomerAccountEntry.Kind.REPAYMENT, amount=-amount,
                                                method=method, reference=payload.get("reference", ""),
                                                user=context.user, cash_session=session, device=context.device,
                                                client_timestamp=context.client_timestamp)
    touch_customer(customer)
    return entry
