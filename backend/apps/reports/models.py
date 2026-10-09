from django.conf import settings
from django.db import models


class ScheduledReport(models.Model):
    """Rapport envoyé automatiquement par e-mail (Excel en pièce jointe, PDF si disponible)."""

    class Frequency(models.TextChoices):
        DAILY = "DAILY", "Chaque jour (veille)"
        WEEKLY = "WEEKLY", "Chaque lundi (semaine écoulée)"
        MONTHLY = "MONTHLY", "Le 1er du mois (mois écoulé)"

    name = models.CharField("libellé", max_length=120)
    report = models.CharField("rapport", max_length=20)
    frequency = models.CharField("fréquence", max_length=10, choices=Frequency.choices, default=Frequency.WEEKLY)
    recipients = models.JSONField("destinataires (e-mails)", default=list)
    filters = models.JSONField("filtres (dépôt…)", default=dict, blank=True)
    send_hour = models.PositiveSmallIntegerField("heure d'envoi", default=7)
    is_active = models.BooleanField("actif", default=True)
    last_sent_at = models.DateTimeField("dernier envoi", null=True, blank=True)
    last_error = models.CharField("dernière erreur", max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "rapport planifié"
        verbose_name_plural = "rapports planifiés"

    def __str__(self):
        return self.name
