"""Écriture du journal d'audit."""
import json

from django.core.serializers.json import DjangoJSONEncoder

from apps.core.request_context import get_client_ip, get_client_timestamp, get_request_device

from .models import AuditLog


def _jsonable(values):
    if values is None:
        return None
    return json.loads(json.dumps(values, cls=DjangoJSONEncoder))


def diff_values(old: dict, new: dict):
    """Ne conserve que les champs modifiés : retourne (anciennes, nouvelles) valeurs."""
    keys = sorted(set(old) | set(new))
    changed = [k for k in keys if old.get(k) != new.get(k)]
    return {k: old.get(k) for k in changed}, {k: new.get(k) for k in changed}


def log_event(
    action,
    *,
    request=None,
    user=None,
    entity="",
    entity_id="",
    description="",
    old_values=None,
    new_values=None,
    device=None,
    client_timestamp=None,
    origin=AuditLog.Origin.ONLINE,
    username="",
):
    if user is None and request is not None and getattr(request, "user", None) and request.user.is_authenticated:
        user = request.user
    if device is None:
        device = get_request_device(request)
    if client_timestamp is None:
        client_timestamp = get_client_timestamp(request)
    from .tracking import mark_logged

    mark_logged(entity, entity_id)
    return AuditLog.objects.create(
        action=action,
        entity=entity,
        entity_id=str(entity_id or ""),
        description=description[:255],
        user=user,
        username=(user.get_username() if user else username)[:150],
        role_code=(user.role_code or "") if user else "",
        device=device,
        ip_address=get_client_ip(request),
        client_timestamp=client_timestamp,
        old_values=_jsonable(old_values),
        new_values=_jsonable(new_values),
        origin=origin,
    )
