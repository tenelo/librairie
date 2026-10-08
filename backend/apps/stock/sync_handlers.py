"""Opérations de stock acceptées hors connexion : pertes / casse et ajustements."""
from rest_framework.exceptions import ValidationError

from apps.catalog.models import Article
from apps.sync.registry import register_push

from .models import Depot, StockMovement
from .services import record_movement, refresh_alerts


@register_push("stock_adjustment", "create", permission="stock.manage")
def create_adjustment(context, payload):
    """Perte (quantité retirée) ou ajustement signé saisi hors ligne. Le stock peut devenir négatif :
    l'opération a eu lieu physiquement, l'écart apparaîtra dans l'état des stocks."""
    kind = payload.get("kind", StockMovement.Kind.LOSS)
    if kind not in (StockMovement.Kind.LOSS, StockMovement.Kind.ADJUSTMENT):
        raise ValidationError({"kind": "Type de mouvement non autorisé hors ligne."})
    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "Le motif est obligatoire."})
    article = Article.objects.get(pk=payload["article"])
    depot = Depot.objects.get(pk=payload["depot"])
    quantity = int(payload["quantity"])
    if kind == StockMovement.Kind.LOSS:
        quantity = -abs(quantity)
    movement = record_movement(article, depot, kind, quantity, user=context.user, reason=reason,
                               unit_cost=article.avg_cost, source_type=kind, movement_id=payload.get("movement_id"),
                               device=context.device, client_timestamp=context.client_timestamp,
                               occurred_at=context.client_timestamp)
    if movement is None:
        raise ValidationError({"article": "Cet article n'a pas de stock propre."})
    refresh_alerts([movement.article])
    return {"movement": str(movement.pk), "article": str(movement.article_id), "quantity": movement.quantity}
