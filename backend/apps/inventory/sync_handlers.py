"""Comptages d'inventaire saisis sur les terminaux (hors connexion possible)."""
from apps.sync.registry import register_pull, register_push

from . import services
from .models import InventorySession


@register_push("inventory_count", "create", permission="inventory.count")
def push_count(context, payload):
    count = services.add_count(context, payload)
    return {"count": str(count.pk)}


def serialize_session(obj: InventorySession):
    countable = obj.status in InventorySession.COUNTABLE and not obj.is_deleted
    return {
        "id": str(obj.pk), "sync_version": obj.sync_version, "is_deleted": not countable, "number": obj.number,
        "name": obj.name, "kind": obj.kind, "status": obj.status, "depot": str(obj.depot_id),
        "counting_mode": obj.counting_mode,
        "articles": [str(pk) for pk in obj.snapshots.values_list("article_id", flat=True)] if countable else [],
        "assignments": [{"user": a.user.username, "zone": a.zone,
                         "categories": [str(pk) for pk in a.categories.values_list("pk", flat=True)]}
                        for a in obj.assignments.select_related("user")] if countable else [],
    }


def register_inventory_sources():
    register_pull("inventory_sessions", lambda: InventorySession.all_objects.all(), serialize_session,
                  "inventory.count")
