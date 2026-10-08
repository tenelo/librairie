"""Événements d'audit produits hors connexion (déverrouillages PIN, réimpressions, ouvertures de tiroir)."""
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.sync.registry import register_push

from .models import AuditLog
from .services import log_event

OFFLINE_ACTIONS = {
    AuditLog.Action.PIN_UNLOCK, AuditLog.Action.PIN_FAILED, AuditLog.Action.REPRINT, AuditLog.Action.DRAWER_OPEN,
    AuditLog.Action.DISCOUNT_OVERRIDE,
}


@register_push("audit_event", "create")
def create_audit_event(context, payload):
    action = payload.get("action")
    if action not in OFFLINE_ACTIONS:
        raise ValidationError({"action": "Événement d'audit non autorisé depuis un terminal."})
    # L'événement est attribué à l'utilisateur concerné (ex. le caissier qui a déverrouillé), sinon à l'émetteur.
    username = payload.get("username") or ""
    user = User.objects.filter(username=username).first() or context.user
    entry = log_event(action, user=user, device=context.device, entity=payload.get("entity", ""),
                      entity_id=payload.get("entity_id", ""), description=payload.get("description", "")[:255],
                      client_timestamp=context.client_timestamp, origin=AuditLog.Origin.SYNC, username=username)
    return {"audit": str(entry.pk)}
