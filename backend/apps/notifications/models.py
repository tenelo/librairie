from django.conf import settings
from django.db import models

from apps.core.models import SyncModel


class Notification(SyncModel):
    """Notification destinée à un utilisateur (affichée dans la cloche, relayée sur les autres canaux)."""

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name="destinataire", on_delete=models.CASCADE,
                                  related_name="notifications")
    event = models.CharField("événement", max_length=40, db_index=True)
    title = models.CharField("titre", max_length=150)
    body = models.CharField("message", max_length=500, blank=True)
    url = models.CharField("lien", max_length=255, blank=True)
    data = models.JSONField("données", default=dict, blank=True)
    read_at = models.DateTimeField("lue le", null=True, blank=True, db_index=True)
    # Canaux effectivement utilisés et résultat (ex. {"push": "ok", "sms": "console"}).
    deliveries = models.JSONField("envois", default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "notification"
        indexes = [models.Index(fields=["recipient", "read_at"])]

    def __str__(self):
        return f"{self.title} → {self.recipient}"


class NotificationPreference(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_prefs")
    event = models.CharField("événement", max_length=40)
    in_app = models.BooleanField("dans l'application", default=True)
    push = models.BooleanField("notification push", default=True)
    email = models.BooleanField("e-mail", default=False)
    sms = models.BooleanField("SMS / WhatsApp", default=False)

    class Meta:
        verbose_name = "préférence de notification"
        constraints = [models.UniqueConstraint(fields=["user", "event"], name="unique_notification_pref")]


class PushSubscription(models.Model):
    """Abonnement Web Push d'un navigateur (backoffice ou boutique)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.URLField("point de terminaison", max_length=500, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    app = models.CharField("application", max_length=20, default="backoffice")
    user_agent = models.CharField(max_length=255, blank=True)
    device = models.ForeignKey("accounts.Device", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    last_success_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "abonnement push"
