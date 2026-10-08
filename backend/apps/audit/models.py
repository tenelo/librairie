import uuid

from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """Entrée du journal d'audit. Écrite uniquement par le code serveur, jamais modifiable via l'API."""

    class Action(models.TextChoices):
        CREATE = "CREATE", "Création"
        UPDATE = "UPDATE", "Modification"
        DELETE = "DELETE", "Suppression"
        LOGIN = "LOGIN", "Connexion"
        LOGIN_FAILED = "LOGIN_FAILED", "Échec de connexion"
        LOGOUT = "LOGOUT", "Déconnexion"
        PIN_SET = "PIN_SET", "Définition du PIN"
        PIN_UNLOCK = "PIN_UNLOCK", "Déverrouillage par PIN"
        PIN_FAILED = "PIN_FAILED", "Échec de PIN"
        PASSWORD_CHANGE = "PASSWORD_CHANGE", "Changement de mot de passe"
        PERMISSIONS_CHANGE = "PERMISSIONS_CHANGE", "Modification des permissions"
        DISCOUNT_OVERRIDE = "DISCOUNT_OVERRIDE", "Remise au-delà du plafond"
        REFUND = "REFUND", "Retour / remboursement"
        CANCEL = "CANCEL", "Annulation"
        REPRINT = "REPRINT", "Réimpression de reçu"
        DRAWER_OPEN = "DRAWER_OPEN", "Ouverture de tiroir / caisse"
        PRICE_CHANGE = "PRICE_CHANGE", "Modification de prix"
        INVENTORY_VALIDATE = "INVENTORY_VALIDATE", "Validation d'inventaire"
        SYNC_CONFLICT = "SYNC_CONFLICT", "Conflit de synchronisation"

    class Origin(models.TextChoices):
        ONLINE = "ONLINE", "En ligne"
        SYNC = "SYNC", "Synchronisation"
        SYSTEM = "SYSTEM", "Système"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action = models.CharField("action", max_length=32, choices=Action.choices, db_index=True)
    entity = models.CharField("entité", max_length=64, blank=True, db_index=True)
    entity_id = models.CharField("identifiant", max_length=64, blank=True, db_index=True)
    description = models.CharField("description", max_length=255, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="utilisateur", on_delete=models.SET_NULL, null=True, blank=True
    )
    username = models.CharField("identifiant utilisateur", max_length=150, blank=True)
    role_code = models.CharField("rôle", max_length=20, blank=True)
    device = models.ForeignKey(
        "accounts.Device", verbose_name="terminal", on_delete=models.SET_NULL, null=True, blank=True
    )
    ip_address = models.GenericIPAddressField("adresse IP", null=True, blank=True)
    server_timestamp = models.DateTimeField("date serveur", auto_now_add=True, db_index=True)
    client_timestamp = models.DateTimeField("date client", null=True, blank=True)
    old_values = models.JSONField("anciennes valeurs", null=True, blank=True)
    new_values = models.JSONField("nouvelles valeurs", null=True, blank=True)
    origin = models.CharField("origine", max_length=10, choices=Origin.choices, default=Origin.ONLINE)

    class Meta:
        ordering = ["-server_timestamp"]
        verbose_name = "entrée d'audit"
        verbose_name_plural = "journal d'audit"

    def __str__(self):
        return f"{self.server_timestamp:%Y-%m-%d %H:%M} {self.action} {self.entity} {self.username}"
