"""Canaux de diffusion des notifications.

`NotificationChannel` est l'interface commune ; chaque canal renvoie un court statut
(« ok », « skipped: … », « error: … ») conservé sur la notification. Les canaux SMS et WhatsApp
délèguent à un `MessageProvider` configurable (`SMS_PROVIDER`, `WHATSAPP_PROVIDER`) ; le
fournisseur par défaut écrit le message dans les journaux (console), prêt à être remplacé par
un agrégateur (Orange SMS API, Twilio, etc.).
"""
import json
import logging
from abc import ABC, abstractmethod

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from django.utils.module_loading import import_string

from apps.core.consumers import user_group

logger = logging.getLogger("librairie.notifications")


class NotificationChannel(ABC):
    code = "abstract"

    @abstractmethod
    def send(self, notification) -> str:
        """Diffuse la notification ; renvoie un statut court."""


class InAppChannel(NotificationChannel):
    """Notification enregistrée (cloche) et poussée en temps réel par WebSocket."""

    code = "in_app"

    def send(self, notification):
        from .serializers import NotificationSerializer

        layer = get_channel_layer()
        if layer is None:
            return "skipped: pas de couche Channels"
        unread = notification.recipient.notifications.filter(read_at__isnull=True).count()
        async_to_sync(layer.group_send)(user_group(notification.recipient_id), {
            "type": "push_message",
            "payload": {"type": "notification", "notification": NotificationSerializer(notification).data,
                        "unread": unread},
        })
        return "ok"


class WebPushChannel(NotificationChannel):
    """Web Push (VAPID) vers tous les navigateurs abonnés de l'utilisateur, même application fermée."""

    code = "push"

    def send(self, notification):
        if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
            return "skipped: clés VAPID absentes"
        from pywebpush import WebPushException, webpush

        subscriptions = list(notification.recipient.push_subscriptions.all())
        if not subscriptions:
            return "skipped: aucun abonnement"
        # Format compris par le service worker Angular (notificationclick → ouverture du lien).
        payload = json.dumps({"notification": {
            "title": notification.title, "body": notification.body, "icon": "icons/icon-192x192.png",
            "badge": "icons/icon-72x72.png", "tag": str(notification.pk),
            "data": {"url": notification.url, "onActionClick": {
                "default": {"operation": "navigateLastFocusedOrOpen", "url": notification.url or "/"}}},
        }})
        sent = 0
        for subscription in subscriptions:
            try:
                webpush(subscription_info={"endpoint": subscription.endpoint,
                                           "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth}},
                        data=payload, vapid_private_key=settings.VAPID_PRIVATE_KEY,
                        vapid_claims={"sub": settings.VAPID_CLAIMS_EMAIL}, ttl=24 * 3600)
                subscription.last_success_at = timezone.now()
                subscription.save(update_fields=["last_success_at"])
                sent += 1
            except WebPushException as exc:
                status = getattr(exc.response, "status_code", None)
                if status in (404, 410):  # abonnement expiré ou révoqué par le navigateur
                    subscription.delete()
                else:
                    logger.warning("Web Push en échec (%s) : %s", status, exc)
        return f"ok ({sent}/{len(subscriptions)})" if sent else "error: aucun envoi"


class EmailChannel(NotificationChannel):
    code = "email"

    def send(self, notification):
        email = notification.recipient.email
        if not email:
            return "skipped: pas d'adresse e-mail"
        base = settings.BOUTIQUE_URL if notification.recipient.is_client else settings.BACKOFFICE_URL
        link = f"\n\n{base.rstrip('/')}{notification.url}" if notification.url else ""
        send_mail(notification.title, f"{notification.body}{link}", settings.DEFAULT_FROM_EMAIL, [email],
                  fail_silently=False)
        return "ok"


class MessageProvider(ABC):
    @abstractmethod
    def send(self, phone: str, text: str) -> str:
        """Envoie un message court ; renvoie la référence du fournisseur."""


class ConsoleMessageProvider(MessageProvider):
    """Fournisseur par défaut : écrit le message dans les journaux (aucun envoi réel)."""

    def __init__(self, kind="SMS"):
        self.kind = kind

    def send(self, phone, text):
        logger.info("[%s console] → %s : %s", self.kind, phone, text)
        return "console"


class SmsChannel(NotificationChannel):
    code = "sms"

    def send(self, notification):
        phone = notification.recipient.phone
        if not phone:
            return "skipped: pas de téléphone"
        provider = import_string(getattr(settings, "SMS_PROVIDER", "apps.notifications.channels.ConsoleMessageProvider"))()
        text = f"{notification.title} : {notification.body}"[:320]
        return f"ok ({provider.send(phone, text)})"


CHANNEL_CLASSES = {cls.code: cls for cls in (InAppChannel, WebPushChannel, EmailChannel, SmsChannel)}
