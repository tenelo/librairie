"""Cycle d'achat : bons de commande, réceptions (avec CMP) et suggestions de réapprovisionnement."""
import math
from datetime import timedelta

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.catalog.models import Article, Kit
from apps.core.numbering import next_document_number
from apps.stock.models import StockMovement
from apps.stock.services import available, record_movement, refresh_alerts, stock_target, update_average_cost

from .models import GoodsReceipt, GoodsReceiptLine, PurchaseOrder, PurchaseOrderLine, SupplierArticle

Status = PurchaseOrder.Status


def send_order(order: PurchaseOrder):
    if order.status != Status.DRAFT:
        raise ValidationError({"status": "Seul un bon en brouillon peut être envoyé."})
    if not order.lines.exists():
        raise ValidationError({"lines": "Le bon de commande est vide."})
    order.status = Status.SENT
    order.sent_at = timezone.now()
    order.save(update_fields=["status", "sent_at"])
    return order


def cancel_order(order: PurchaseOrder):
    if order.status in (Status.RECEIVED, Status.CANCELLED):
        raise ValidationError({"status": "Ce bon de commande ne peut plus être annulé."})
    if order.status == Status.PARTIAL:
        raise ValidationError({"status": "Des marchandises ont déjà été reçues : soldez plutôt le bon."})
    order.status = Status.CANCELLED
    order.save(update_fields=["status"])
    return order


def close_order(order: PurchaseOrder):
    """Solde un bon partiellement reçu (le reliquat ne sera pas livré)."""
    if order.status != Status.PARTIAL:
        raise ValidationError({"status": "Seul un bon partiellement reçu peut être soldé."})
    order.status = Status.RECEIVED
    order.save(update_fields=["status"])
    return order


def _refresh_order_status(order: PurchaseOrder):
    lines = list(order.lines.all())
    if all(line.received_quantity >= line.quantity for line in lines):
        status = Status.RECEIVED
    elif any(line.received_quantity > 0 for line in lines):
        status = Status.PARTIAL
    else:
        status = order.status
    if status != order.status:
        order.status = status
        order.save(update_fields=["status"])


@transaction.atomic
def receive_goods(*, supplier, depot, lines, user=None, purchase_order=None, received_at=None, delivery_note="",
                  note="", receipt_id=None, device=None, client_timestamp=None):
    """Enregistre une réception totale ou partielle.

    `lines` : liste de dicts {article, quantity, unit_cost, order_line?}. Pour chaque ligne :
    mise à jour du CMP (avant l'entrée en stock), mouvement d'entrée, quantité reçue sur le bon
    de commande et dernier prix fournisseur. Idempotent sur `receipt_id` (UUID du terminal).
    """
    if receipt_id is not None:
        existing = GoodsReceipt.all_objects.filter(pk=receipt_id).first()
        if existing is not None:
            return existing
    if purchase_order is not None:
        if purchase_order.status not in PurchaseOrder.OPEN_STATUSES:
            raise ValidationError({"purchase_order": "Ce bon de commande n'est pas en attente de livraison."})
        if purchase_order.supplier_id != supplier.pk:
            raise ValidationError({"supplier": "Le fournisseur ne correspond pas au bon de commande."})
    lines = [line for line in lines if int(line["quantity"]) > 0]
    if not lines:
        raise ValidationError({"lines": "Aucune quantité reçue."})

    receipt = GoodsReceipt(number=next_document_number("REC"), supplier=supplier, depot=depot,
                           purchase_order=purchase_order, received_at=received_at or timezone.now(),
                           delivery_note=delivery_note, note=note, user=user, device=device,
                           client_timestamp=client_timestamp)
    if receipt_id is not None:
        receipt.id = receipt_id
    receipt.save()

    touched = []
    for data in lines:
        article = data["article"]
        quantity, unit_cost = int(data["quantity"]), int(data["unit_cost"])
        order_line = data.get("order_line")
        if order_line is not None:
            if purchase_order is None or order_line.order_id != purchase_order.pk:
                raise ValidationError({"lines": "Ligne de commande étrangère à ce bon."})
            if order_line.article_id != article.pk:
                raise ValidationError({"lines": f"Article différent de la ligne commandée ({article.name})."})
        target, base_quantity = stock_target(article, quantity)
        if target is None:
            raise ValidationError({"lines": f"« {article.name} » n'est pas un article stocké."})
        base_cost = unit_cost if target.pk == article.pk else round(unit_cost * quantity / base_quantity)
        update_average_cost(target, base_quantity, base_cost, user=user, reason=f"Réception {receipt.number}")
        record_movement(article, depot, StockMovement.Kind.PURCHASE, quantity, unit_cost=unit_cost, user=user,
                        occurred_at=receipt.received_at, reference=receipt.number, source_type="GoodsReceipt",
                        source_id=receipt.pk, device=device, client_timestamp=client_timestamp)
        GoodsReceiptLine.objects.create(receipt=receipt, article=article, order_line=order_line, quantity=quantity,
                                        unit_cost=unit_cost)
        if order_line is not None:
            PurchaseOrderLine.all_objects.filter(pk=order_line.pk).update(
                received_quantity=F("received_quantity") + quantity)
            order_line.refresh_from_db()
            order_line.save(update_fields=["received_quantity"])
        link, _ = SupplierArticle.objects.get_or_create(supplier=supplier, article=article)
        link.last_cost = unit_cost
        link.last_received_at = receipt.received_at
        link.save(update_fields=["last_cost", "last_received_at"])
        touched.append(target)

    if purchase_order is not None:
        _refresh_order_status(purchase_order)
        # Nouvelle version du bon : les terminaux reçoivent les reliquats à jour.
        purchase_order.save(update_fields=["updated_at"])
    refresh_alerts(touched)
    return receipt


# --- Suggestions de réapprovisionnement --------------------------------------------------------


def on_order_quantities():
    """Reliquats des bons envoyés ou partiellement reçus, par article."""
    totals = {}
    for line in PurchaseOrderLine.objects.filter(order__status__in=PurchaseOrder.OPEN_STATUSES):
        totals[line.article_id] = totals.get(line.article_id, 0) + line.remaining
    return totals


def sales_velocity(days=90):
    """Sorties de vente par article sur la période (unités / jour), kits et lots déjà convertis."""
    since = timezone.now() - timedelta(days=days)
    rows = (StockMovement.objects.filter(kind=StockMovement.Kind.SALE, occurred_at__gte=since)
            .values("article_id").annotate(total=Sum("quantity")))
    return {row["article_id"]: -row["total"] / days for row in rows}


def reorder_suggestions(*, days=90, coverage_days=30, supplier=None):
    """Articles à recommander.

    Point de commande = seuil d'alerte + consommation pendant le délai fournisseur.
    Un article est proposé si (disponible + en commande) ≤ point de commande. Quantité proposée :
    jusqu'au stock maximum s'il est renseigné, sinon seuil + `coverage_days` jours de ventes.
    """
    velocity = sales_velocity(days)
    ordered = on_order_quantities()
    links = {}
    for link in SupplierArticle.objects.select_related("supplier").order_by("article_id", "-last_received_at"):
        links.setdefault(link.article_id, link)

    articles = Article.objects.filter(is_active=True, type=Article.Type.SIMPLE)
    kits = Article.objects.filter(is_active=True, type=Article.Type.KIT, kit__stock_mode=Kit.StockMode.ASSEMBLED)
    suggestions = []
    for article in list(articles) + list(kits):
        link = links.get(article.pk)
        if supplier is not None and (link is None or link.supplier_id != supplier.pk):
            continue
        daily = velocity.get(article.pk, 0)
        lead = link.supplier.lead_time_days if link else 7
        stock = available(article)
        pending = ordered.get(article.pk, 0)
        reorder_point = article.alert_threshold + math.ceil(daily * lead)
        if stock + pending > reorder_point:
            continue
        target = article.max_stock or (article.alert_threshold + math.ceil(daily * coverage_days))
        quantity = max(target - stock - pending, 0)
        if quantity == 0:
            continue
        suggestions.append({
            "article": article,
            "available": stock,
            "on_order": pending,
            "daily_sales": round(daily, 2),
            "reorder_point": reorder_point,
            "suggested_quantity": quantity,
            "supplier": link.supplier if link else None,
            "unit_cost": link.last_cost if link else int(article.avg_cost),
        })
    suggestions.sort(key=lambda s: (s["supplier"].name if s["supplier"] else "~", s["article"].name))
    return suggestions


@transaction.atomic
def create_orders_from_suggestions(items, depot, user=None):
    """Crée un bon de commande brouillon par fournisseur. `items` : [{article, supplier, quantity, unit_cost}]."""
    by_supplier = {}
    for item in items:
        if item["supplier"] is None:
            raise ValidationError({"items": f"Choisissez un fournisseur pour « {item['article'].name} »."})
        by_supplier.setdefault(item["supplier"].pk, []).append(item)
    orders = []
    for supplier_items in by_supplier.values():
        supplier = supplier_items[0]["supplier"]
        order = PurchaseOrder.objects.create(
            number=next_document_number("BC"), supplier=supplier, depot=depot, order_date=timezone.localdate(),
            expected_date=timezone.localdate() + timedelta(days=supplier.lead_time_days), created_by=user,
            note="Créé depuis les suggestions de réapprovisionnement",
        )
        for item in supplier_items:
            PurchaseOrderLine.objects.create(order=order, article=item["article"], quantity=item["quantity"],
                                             unit_cost=item["unit_cost"])
        orders.append(order)
    return orders

