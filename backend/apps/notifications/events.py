"""Catalogue des événements notifiés.

Chaque événement précise son public (personnel ou client), la permission qui désigne les
destinataires parmi le personnel, et les canaux activés par défaut ; chaque utilisateur peut
ensuite ajuster ses préférences canal par canal.
"""
from dataclasses import dataclass, field

STAFF = "staff"
CUSTOMER = "customer"
CHANNELS = ("in_app", "push", "email", "sms")


@dataclass(frozen=True)
class EventType:
    code: str
    label: str
    audience: str
    permission: str | None = None
    defaults: tuple = ("in_app", "push")
    description: str = ""
    extra: dict = field(default_factory=dict)


EVENTS = {e.code: e for e in [
    # --- Personnel ---------------------------------------------------------------------------
    EventType("order_placed", "Nouvelle commande en ligne", STAFF, "orders.confirm"),
    EventType("order_cancelled_by_customer", "Commande annulée par le client", STAFF, "orders.confirm"),
    EventType("order_approval_answered", "Réponse du client à une modification", STAFF, "orders.prepare"),
    EventType("order_expiring", "Commande non retirée bientôt expirée", STAFF, "orders.view", ("in_app",)),
    EventType("stock_low", "Stock bas ou rupture", STAFF, "purchasing.manage", ("in_app",)),
    EventType("cash_variance", "Écart de caisse à la clôture", STAFF, "cash.z_report"),
    EventType("authorization_request", "Demande d'autorisation (remise, retour)", STAFF, "sales.authorize"),
    EventType("sync_error", "Erreur de synchronisation", STAFF, "sync.manage", ("in_app",)),
    EventType("inventory_review", "Inventaire en attente de validation", STAFF, "inventory.validate"),
    # --- Client -------------------------------------------------------------------------------
    EventType("order_confirmed", "Commande confirmée", CUSTOMER, defaults=("in_app", "push")),
    EventType("order_preparing", "Commande en préparation", CUSTOMER, defaults=("in_app",)),
    EventType("order_approval", "Modification de commande à valider", CUSTOMER, defaults=("in_app", "push", "sms")),
    EventType("order_ready", "Commande prête à retirer", CUSTOMER, defaults=("in_app", "push", "email", "sms")),
    EventType("order_reminder", "Rappel avant expiration", CUSTOMER, defaults=("in_app", "push", "sms")),
    EventType("order_cancelled", "Commande annulée", CUSTOMER, defaults=("in_app", "push", "email")),
    EventType("order_expired", "Commande expirée", CUSTOMER, defaults=("in_app", "push")),
    EventType("deposit_paid", "Acompte reçu", CUSTOMER, defaults=("in_app",)),
]}


def events_for(user) -> list[EventType]:
    """Événements pertinents pour un utilisateur (clients : leurs commandes ; personnel : selon ses droits)."""
    if user.is_client:
        return [e for e in EVENTS.values() if e.audience == CUSTOMER]
    return [e for e in EVENTS.values() if e.audience == STAFF and (not e.permission or user.has_app_perm(e.permission))]
