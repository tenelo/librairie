"""Préparation des commandes hors ligne et commandes à préparer descendues vers les terminaux."""
from rest_framework.exceptions import ValidationError

from apps.sync.registry import register_pull, register_push

from . import services
from .models import OnlineOrder

# Commandes utiles aux terminaux : à préparer (préparation hors ligne) et prêtes (retrait à la caisse).
TERMINAL_STATUSES = (OnlineOrder.Status.CONFIRMED, OnlineOrder.Status.PREPARING, OnlineOrder.Status.READY)


@register_push("online_order", "prepare", permission="orders.prepare")
def push_prepare(context, payload):
    order = OnlineOrder.objects.filter(pk=payload.get("order")).first()
    if order is None:
        raise ValidationError({"order": "Commande inconnue."})
    order = services.prepare(order, context.user, lines=payload.get("lines") or [],
                             shortages=payload.get("shortages") or [], ready=bool(payload.get("ready")),
                             parcels=payload.get("parcels"))
    return {"status": order.status, "awaiting_customer": order.awaiting_customer}


def serialize_order(obj: OnlineOrder):
    visible = obj.status in TERMINAL_STATUSES and not obj.is_deleted
    data = {"id": str(obj.pk), "sync_version": obj.sync_version, "is_deleted": not visible, "number": obj.number,
            "status": obj.status}
    if not visible:
        return data
    data.update({
        "customer": str(obj.customer_id), "customer_name": obj.customer.name, "customer_phone": obj.customer.phone,
        "pickup_depot": str(obj.pickup_depot_id), "pickup_code": obj.pickup_code, "qr_payload": obj.qr_payload,
        "total": obj.total, "deposit_paid": obj.deposit_paid, "awaiting_customer": obj.awaiting_customer,
        "accept_partial": obj.accept_partial, "parcels": obj.parcels, "comment": obj.comment,
        "pickup_slot": obj.pickup_slot.isoformat() if obj.pickup_slot else None,
        "expires_at": obj.expires_at.isoformat() if obj.expires_at else None,
        "created_at": obj.created_at.isoformat(),
        "lines": [{"id": str(line.pk), "article": str(line.article_id), "code": line.article.code,
                   "description": line.description, "quantity": line.quantity, "unit_price": line.unit_price,
                   "line_total": line.line_total, "prepared_qty": line.prepared_qty, "status": line.status,
                   "barcodes": [b.code for b in line.article.barcodes.all() if not b.is_deleted]}
                  for line in obj.lines.all()],
    })
    return data


def register_order_sources():
    register_pull("online_orders",
                  lambda: OnlineOrder.all_objects.select_related("customer").prefetch_related(
                      "lines__article__barcodes"),
                  serialize_order, "orders.view")
