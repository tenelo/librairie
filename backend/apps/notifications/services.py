"""Création et diffusion des notifications selon les préférences de chaque destinataire."""
import logging

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.accounts.catalog import CLIENT
from apps.accounts.models import User

from .channels import CHANNEL_CLASSES
from .events import CHANNELS, EVENTS
from .models import Notification, NotificationPreference

logger = logging.getLogger("librairie.notifications")


def staff_with_permission(code: str):
    """Personnel actif disposant d'une permission (superutilisateurs compris)."""
    return (User.objects.filter(is_active=True)
            .filter(Q(is_superuser=True) | Q(role__permissions__code=code))
            .exclude(role__code=CLIENT).distinct())


def channels_for(user, event_code: str) -> list[str]:
    """Canaux retenus : préférence enregistrée, sinon valeurs par défaut de l'événement."""
    event = EVENTS[event_code]
    preference = NotificationPreference.objects.filter(user=user, event=event_code).first()
    if preference is None:
        return list(event.defaults)
    return [channel for channel in CHANNELS if getattr(preference, channel)]


def notify(event_code: str, recipients, *, title: str, body: str = "", url: str = "", data=None,
           exclude=None) -> list[Notification]:
    """Notifie une liste d'utilisateurs ; la diffusion part après la validation de la transaction."""
    if event_code not in EVENTS:
        raise ValueError(f"Événement de notification inconnu : {event_code}")
    created = []
    seen = set()
    for user in recipients:
        if user is None or user.pk in seen or (exclude is not None and user.pk == exclude.pk) or not user.is_active:
            continue
        seen.add(user.pk)
        channels = channels_for(user, event_code)
        if not channels:
            continue
        # La notification est toujours conservée (historique) ; elle n'apparaît comme non lue
        # dans la cloche que si le canal « dans l'application » est actif.
        notification = Notification.objects.create(
            recipient=user, event=event_code, title=title[:150], body=body[:500], url=url[:255], data=data or {},
            deliveries={channel: "en attente" for channel in channels},
            read_at=None if "in_app" in channels else timezone.now())
        created.append((notification, channels))
    for notification, channels in created:
        transaction.on_commit(lambda n=notification, c=channels: _dispatch(n, c))
    return [n for n, _c in created]


def notify_staff(event_code: str, **kwargs) -> list[Notification]:
    permission = EVENTS[event_code].permission
    return notify(event_code, staff_with_permission(permission) if permission else [], **kwargs)


def _dispatch(notification, channels):
    from .tasks import deliver_notification

    try:
        deliver_notification.delay(str(notification.pk), channels)
    except Exception:  # broker indisponible : diffusion immédiate
        logger.exception("File Celery indisponible, diffusion directe de la notification")
        deliver(notification.pk, channels)


def deliver(notification_id, channels):
    notification = Notification.objects.select_related("recipient").filter(pk=notification_id).first()
    if notification is None:
        return {}
    results = {}
    for code in channels:
        channel = CHANNEL_CLASSES.get(code)
        if channel is None:
            continue
        try:
            results[code] = channel().send(notification)
        except Exception as exc:  # un canal en panne ne bloque pas les autres
            logger.exception("Canal %s en échec", code)
            results[code] = f"error: {exc}"[:200]
    notification.deliveries = results
    notification.save(update_fields=["deliveries"])
    return results
