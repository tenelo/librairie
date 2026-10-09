"""Traçage automatique des modifications des données de référence, quel que soit le chemin d'écriture.

Les écrans de l'API journalisent déjà leurs actions de façon explicite (avec un libellé métier).
Ce module complète le journal pour toutes les autres écritures : synchronisation des terminaux,
administration Django, commandes de gestion, tâches Celery. Pour éviter les doublons, les entrées
détectées pendant une requête sont mises en attente et écrites à la fin de celle-ci, sauf si une
entrée explicite a déjà été journalisée pour le même objet.
"""
import contextvars
from contextlib import contextmanager

from django.apps import apps
from django.db import transaction
from django.db.models.signals import post_save, pre_save

TECHNICAL = {"id", "created_at", "updated_at", "sync_version", "device", "client_timestamp", "password", "pin_hash",
             "last_login"}

# Modèles de référence suivis (les documents métier — ventes, mouvements… — ont leur propre journal).
TRACKED_MODELS = [
    "catalog.Article", "catalog.Kit", "catalog.KitComponent", "catalog.Category", "catalog.Brand", "catalog.Unit",
    "catalog.SchoolLevel", "catalog.SchoolYear", "customers.School", "customers.Customer", "stock.Depot",
    "stock.Location", "purchasing.Supplier", "sales.PaymentMethod", "accounts.Device", "accounts.User",
    "accounts.Role", "settings_app.LibrarySettings",
]

_context: contextvars.ContextVar = contextvars.ContextVar("audit_context", default=None)


class AuditContext:
    def __init__(self, request=None):
        self.request = request
        self.logged: set = set()
        self.pending: dict = {}
        # Date client de l'opération de synchronisation en cours (écritures faites hors ligne).
        self.client_timestamp = None


def current():
    return _context.get()


def mark_logged(entity, entity_id):
    """Appelé par `log_event` : l'objet a déjà une entrée explicite dans cette requête."""
    ctx = current()
    if ctx is not None:
        ctx.logged.add((entity, str(entity_id)))


@contextmanager
def audit_context(request=None):
    token = _context.set(AuditContext(request))
    try:
        yield _context.get()
    finally:
        _context.reset(token)


@contextmanager
def operation_scope(client_timestamp=None):
    """Entrées produites par une opération atomique : abandonnées si l'opération échoue."""
    ctx = current()
    before = set(ctx.pending) if ctx else set()
    previous_ts = ctx.client_timestamp if ctx else None
    if ctx is not None:
        ctx.client_timestamp = client_timestamp
    try:
        yield
    except Exception:
        if ctx is not None:
            for key in set(ctx.pending) - before:
                ctx.pending.pop(key, None)
        raise
    finally:
        if ctx is not None:
            ctx.client_timestamp = previous_ts


def flush(ctx: AuditContext):
    from .services import log_event

    for (entity, entity_id), entry in list(ctx.pending.items()):
        if (entity, entity_id) in ctx.logged:
            continue
        log_event(entry["action"], request=ctx.request, user=entry["user"], entity=entity, entity_id=entity_id,
                  description=entry["description"], old_values=entry["old"] or None, new_values=entry["new"] or None,
                  origin=entry["origin"], client_timestamp=entry["client_timestamp"])
    ctx.pending.clear()


def _value(instance, field):
    value = getattr(instance, field.attname)
    if value is None or isinstance(value, (bool, int, float, str, list, dict)):
        return value
    return str(value)


def _snapshot(instance):
    return {f.name: _value(instance, f) for f in instance._meta.concrete_fields if f.name not in TECHNICAL}


def _before_save(sender, instance, raw=False, **kwargs):
    if raw:
        return
    previous = sender._base_manager.filter(pk=instance.pk).first() if instance.pk else None
    instance._audit_before = _snapshot(previous) if previous is not None else None


def _after_save(sender, instance, created, raw=False, update_fields=None, **kwargs):
    if raw:
        return
    from .models import AuditLog

    before = getattr(instance, "_audit_before", None)
    after = _snapshot(instance)
    if before is None:
        action, old, new = AuditLog.Action.CREATE, {}, after
    else:
        changed = [k for k in after if before.get(k) != after.get(k)]
        if not changed:
            return
        old, new = {k: before.get(k) for k in changed}, {k: after.get(k) for k in changed}
        action = AuditLog.Action.DELETE if new.get("is_deleted") is True else AuditLog.Action.UPDATE
    entity = sender.__name__
    label = {AuditLog.Action.CREATE: "Création", AuditLog.Action.UPDATE: "Modification",
             AuditLog.Action.DELETE: "Suppression"}[action]
    ctx = current()
    request = ctx.request if ctx else None
    user = getattr(request, "user", None) if request is not None else None
    entry = {"action": action, "user": user if getattr(user, "is_authenticated", False) else None,
             "description": f"{label} : {str(instance)[:180]}", "old": old, "new": new,
             "origin": _origin(request), "client_timestamp": ctx.client_timestamp if ctx else None}
    key = (entity, str(instance.pk))
    if ctx is not None:
        if key in ctx.pending:  # plusieurs enregistrements dans la même requête : on cumule le diff
            previous = ctx.pending[key]
            entry["old"] = {**entry["old"], **previous["old"]}
            entry["new"] = {**previous["new"], **entry["new"]}
            if previous["action"] == AuditLog.Action.CREATE:
                entry["action"], entry["description"] = previous["action"], previous["description"]
        ctx.pending[key] = entry
        return
    transaction.on_commit(lambda: flush_single(key, entry))


def flush_single(key, entry):
    from .services import log_event

    log_event(entry["action"], entity=key[0], entity_id=key[1], description=entry["description"],
              old_values=entry["old"] or None, new_values=entry["new"] or None, origin=entry["origin"])


def _origin(request):
    from .models import AuditLog

    if request is None:
        return AuditLog.Origin.SYSTEM
    if request.path.startswith("/api/sync/"):
        return AuditLog.Origin.SYNC
    return AuditLog.Origin.ONLINE


def connect():
    for label in TRACKED_MODELS:
        model = apps.get_model(label)
        pre_save.connect(_before_save, sender=model, dispatch_uid=f"audit-pre-{label}")
        post_save.connect(_after_save, sender=model, dispatch_uid=f"audit-post-{label}")


class AuditContextMiddleware:
    """Ouvre un contexte d'audit par requête et écrit, à la fin, les modifications non journalisées."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        with audit_context(request) as ctx:
            response = self.get_response(request)
            if response.status_code < 400 and ctx.pending:
                flush(ctx)
            return response
