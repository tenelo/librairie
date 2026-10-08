"""Traitement des envois (push) et des descentes (pull) de la synchronisation hors connexion."""
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.core.models import current_sync_version
from apps.core.signals import business_event

from .models import SyncConflict, SyncOperation
from .registry import PULL_SOURCES, PUSH_HANDLERS, SyncConflictError, SyncContext

MAX_PULL_LIMIT = 1000


def _jsonable(data):
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def _error_text(exc) -> str:
    detail = getattr(exc, "detail", None)
    if detail is None:
        return str(exc)
    if isinstance(detail, dict):
        return " ".join(f"{k} : {', '.join(map(str, v)) if isinstance(v, list) else v}" for k, v in detail.items())
    if isinstance(detail, list):
        return " ".join(map(str, detail))
    return str(detail)


def apply_operation(op: dict, *, user, device, request=None) -> dict:
    """Applique une opération de façon idempotente et renvoie {id, status, result|error|server_version}."""
    op_id = op["id"]
    existing = SyncOperation.objects.filter(pk=op_id).first()
    if existing is not None:
        response = {"id": str(op_id), "status": existing.status, "replayed": True}
        if existing.status == SyncOperation.Status.OK:
            response["result"] = existing.result
        elif existing.status == SyncOperation.Status.CONFLICT:
            response["server_version"] = existing.result
        else:
            response["error"] = existing.error
        return response

    key = (op["entity"], op["operation"])
    client_ts = op.get("client_timestamp")
    client_ts = parse_datetime(client_ts) if isinstance(client_ts, str) else client_ts
    record = SyncOperation(id=op_id, entity=op["entity"], operation=op["operation"], payload=op.get("payload") or {},
                           client_timestamp=client_ts, device=device, user=user)
    try:
        if key not in PUSH_HANDLERS:
            raise ValidationError(f"Opération inconnue : {op['entity']}.{op['operation']}")
        handler, permission = PUSH_HANDLERS[key]
        if permission and not user.has_app_perm(permission):
            raise PermissionDenied(f"Permission « {permission} » requise.")
        context = SyncContext(user=user, device=device, client_timestamp=client_ts, operation_id=op_id,
                              request=request)
        with transaction.atomic():
            result = handler(context, record.payload) or {}
        record.status = SyncOperation.Status.OK
        record.result = _jsonable(result)
        record.save()
        return {"id": str(op_id), "status": "ok", "result": record.result}
    except SyncConflictError as exc:
        record.status = SyncOperation.Status.CONFLICT
        record.result = _jsonable(exc.server_version)
        record.error = str(exc)
        record.save()
        return {"id": str(op_id), "status": "conflict", "server_version": record.result, "error": record.error}
    except (ValidationError, PermissionDenied, APIException, ValueError, KeyError) as exc:
        record.status = SyncOperation.Status.ERROR
        record.error = _error_text(exc) if not isinstance(exc, KeyError) else f"Champ manquant : {exc}"
        record.save()
        log_event(AuditLog.Action.UPDATE, user=user, device=device, entity="SyncOperation", entity_id=op_id,
                  description=f"Opération rejetée {op['entity']}.{op['operation']} : {record.error}"[:255],
                  origin=AuditLog.Origin.SYNC, client_timestamp=client_ts)
        business_event.send(sender=SyncOperation, event="sync_operation_failed", instance=record, user=user)
        return {"id": str(op_id), "status": "error", "error": record.error}


def push(operations, *, user, device, request=None) -> list:
    results = [apply_operation(op, user=user, device=device, request=request) for op in operations]
    if device is not None:
        device.last_sync_at = timezone.now()
        device.save(update_fields=["last_sync_at", "updated_at"])
    return results


def pull(user, since: int, limit: int = 500, entities=None) -> dict:
    """Toutes les modifications (créations, mises à jour, suppressions logiques) après le curseur `since`.

    Les versions de synchronisation sont globales et uniques : on lit au plus `limit` lignes
    par entité, on fusionne, on garde les `limit` plus petites versions. Toute ligne de version
    inférieure au curseur renvoyé a donc bien été transmise (pas de trou entre deux pages).
    """
    limit = max(1, min(int(limit), MAX_PULL_LIMIT))
    candidates = []
    truncated = False
    for entity, (factory, serialize, permission) in PULL_SOURCES.items():
        if entities and entity not in entities:
            continue
        if permission and not user.has_app_perm(permission):
            continue
        rows = list(factory().filter(sync_version__gt=since).order_by("sync_version")[: limit + 1])
        if len(rows) > limit:
            truncated = True
            rows = rows[:limit]
        candidates.extend((row.sync_version, entity, row, serialize) for row in rows)
    candidates.sort(key=lambda item: item[0])
    has_more = truncated or len(candidates) > limit
    selected = candidates[:limit]
    changes = {}
    for _version, entity, row, serialize in selected:
        changes.setdefault(entity, []).append(_jsonable(serialize(row)))
    cursor = selected[-1][0] if selected else max(since, 0)
    if not has_more:
        cursor = max(cursor, current_sync_version()) if not selected else cursor
    return {"cursor": cursor, "has_more": has_more, "changes": changes, "server_time": timezone.now()}


def record_conflict(operation_id, entity, entity_id, client_payload, server_payload, client_wins: bool, user=None,
                    device=None):
    conflict = SyncConflict.objects.create(
        operation_id=operation_id, entity=entity, entity_id=str(entity_id), client_payload=_jsonable(client_payload),
        server_payload=_jsonable(server_payload),
        resolution=SyncConflict.Resolution.CLIENT_WINS if client_wins else SyncConflict.Resolution.SERVER_WINS,
    )
    log_event(AuditLog.Action.SYNC_CONFLICT, user=user, device=device, entity=entity, entity_id=entity_id,
              description=f"Conflit sur {entity} : {conflict.get_resolution_display()}",
              old_values=server_payload, new_values=client_payload, origin=AuditLog.Origin.SYNC)
    return conflict


def last_writer_wins(*, instance, changes: dict, base_version: int, client_timestamp, context, serialize):
    """Règle « dernier écrit gagne » pour les données modifiables hors ligne (fiche client…).

    - Si personne n'a modifié la donnée depuis la version connue du terminal : on applique.
    - Sinon, conflit : la modification la plus récente (date client vs date serveur) l'emporte ;
      le conflit est tracé (écran Conflits + audit). Si le serveur l'emporte, SyncConflictError.
    """
    if instance.sync_version <= int(base_version or 0):
        for name, value in changes.items():
            setattr(instance, name, value)
        instance.save()
        return serialize(instance)
    server_version = serialize(instance)
    client_wins = client_timestamp is not None and client_timestamp > instance.updated_at
    record_conflict(context.operation_id, instance.__class__.__name__, instance.pk, changes, server_version,
                    client_wins, user=context.user, device=context.device)
    if not client_wins:
        raise SyncConflictError(server_version)
    for name, value in changes.items():
        setattr(instance, name, value)
    instance.save()
    return serialize(instance)
