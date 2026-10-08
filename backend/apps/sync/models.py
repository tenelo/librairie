"""Journal des opérations reçues des terminaux (garantit l'idempotence) et des conflits."""
import uuid

from django.conf import settings
from django.db import models


class SyncOperation(models.Model):
    """Opération de l'outbox d'un terminal. Son identifiant est celui généré par le terminal :
    une opération rejouée (réseau coupé pendant la réponse) renvoie le résultat déjà enregistré."""

    class Status(models.TextChoices):
        OK = "ok", "Appliquée"
        CONFLICT = "conflict", "Conflit"
        ERROR = "error", "Erreur"

    id = models.UUIDField(primary_key=True, editable=False)
    entity = models.CharField("entité", max_length=40, db_index=True)
    operation = models.CharField("opération", max_length=20)
    payload = models.JSONField("contenu")
    client_timestamp = models.DateTimeField("date client", null=True, blank=True)
    received_at = models.DateTimeField("reçue le", auto_now_add=True, db_index=True)
    status = models.CharField("statut", max_length=10, choices=Status.choices)
    result = models.JSONField("résultat", null=True, blank=True)
    error = models.TextField("erreur", blank=True)
    device = models.ForeignKey("accounts.Device", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="+")

    class Meta:
        ordering = ["-received_at"]
        verbose_name = "opération synchronisée"
        verbose_name_plural = "opérations synchronisées"


class SyncConflict(models.Model):
    """Conflit détecté sur une donnée modifiable (règle « dernier écrit gagne »)."""

    class Resolution(models.TextChoices):
        CLIENT_WINS = "client", "Version du terminal retenue"
        SERVER_WINS = "server", "Version du serveur conservée"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    operation = models.ForeignKey(SyncOperation, on_delete=models.CASCADE, related_name="conflicts")
    entity = models.CharField("entité", max_length=40)
    entity_id = models.CharField("identifiant", max_length=64)
    client_payload = models.JSONField("version du terminal")
    server_payload = models.JSONField("version du serveur")
    resolution = models.CharField("résolution", max_length=10, choices=Resolution.choices)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField("examiné le", null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="+")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "conflit de synchronisation"
