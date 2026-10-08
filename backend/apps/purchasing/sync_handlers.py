"""Réceptions de marchandises saisies hors connexion."""
from apps.catalog.models import Article
from apps.stock.models import Depot
from apps.sync.registry import register_push

from .models import PurchaseOrder, PurchaseOrderLine, Supplier
from .services import receive_goods


@register_push("goods_receipt", "create", permission="purchasing.receive")
def create_receipt(context, payload):
    order = PurchaseOrder.objects.get(pk=payload["purchase_order"]) if payload.get("purchase_order") else None
    lines = [{
        "article": Article.objects.get(pk=line["article"]),
        "quantity": int(line["quantity"]),
        "unit_cost": int(line["unit_cost"]),
        "order_line": PurchaseOrderLine.objects.get(pk=line["order_line"]) if line.get("order_line") else None,
    } for line in payload["lines"]]
    receipt = receive_goods(
        supplier=Supplier.objects.get(pk=payload["supplier"]), depot=Depot.objects.get(pk=payload["depot"]),
        lines=lines, user=context.user, purchase_order=order, received_at=context.client_timestamp,
        delivery_note=payload.get("delivery_note", ""), note=payload.get("note", ""),
        receipt_id=payload.get("id"), device=context.device, client_timestamp=context.client_timestamp,
    )
    return {"receipt": str(receipt.pk), "number": receipt.number}
