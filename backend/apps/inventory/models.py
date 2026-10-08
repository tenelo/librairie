"""Inventaires : sessions (complet, partiel, tournant), gel du stock théorique, comptages
multi-utilisateurs (hors connexion possible), double comptage, validation et ajustements."""
from django.conf import settings
from django.db import models

from apps.core.models import SyncModel


class InventorySession(SyncModel):
    class Kind(models.TextChoices):
        FULL = "FULL", "Inventaire complet"
        PARTIAL = "PARTIAL", "Inventaire partiel"
        CYCLE = "CYCLE", "Inventaire tournant"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Préparation"
        COUNTING = "COUNTING", "Comptage en cours"
        REVIEW = "REVIEW", "Revue des écarts"
        VALIDATED = "VALIDATED", "Validé"
        CLOSED = "CLOSED", "Clôturé"
        CANCELLED = "CANCELLED", "Annulé"

    class CountingMode(models.TextChoices):
        SUM = "SUM", "Comptages additionnés"
        DOUBLE = "DOUBLE", "Double comptage si écart"

    COUNTABLE = (Status.COUNTING, Status.REVIEW)

    number = models.CharField("numéro", max_length=30, unique=True)
    name = models.CharField("libellé", max_length=150)
    kind = models.CharField("type", max_length=10, choices=Kind.choices)
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.DRAFT)
    depot = models.ForeignKey("stock.Depot", on_delete=models.PROTECT, related_name="inventories")
    categories = models.ManyToManyField("catalog.Category", blank=True, related_name="+")
    locations = models.ManyToManyField("stock.Location", blank=True, related_name="+")
    articles = models.ManyToManyField("catalog.Article", blank=True, related_name="+")
    counting_mode = models.CharField("mode de comptage", max_length=10, choices=CountingMode.choices,
                                     default=CountingMode.SUM)
    double_count_threshold = models.PositiveIntegerField("seuil de double comptage (unités)", default=0)
    frozen_at = models.DateTimeField("stock gelé le", null=True, blank=True)
    validated_at = models.DateTimeField("validé le", null=True, blank=True)
    closed_at = models.DateTimeField("clôturé le", null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    validated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
                                     related_name="+")
    notes = models.TextField("remarques", blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "inventaire"


class InventoryAssignment(SyncModel):
    """Zone confiée à un inventoriste (catégories, emplacements ou consigne libre)."""

    session = models.ForeignKey(InventorySession, on_delete=models.CASCADE, related_name="assignments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    categories = models.ManyToManyField("catalog.Category", blank=True, related_name="+")
    zone = models.CharField("zone / consigne", max_length=150, blank=True)


class InventorySnapshot(models.Model):
    """Stock théorique gelé au démarrage (somme des mouvements jusqu'à `frozen_at`)."""

    session = models.ForeignKey(InventorySession, on_delete=models.CASCADE, related_name="snapshots")
    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="+")
    theoretical = models.IntegerField("stock théorique")
    unit_cost = models.BigIntegerField("CMP au gel")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["session", "article"], name="unique_inventory_snapshot")]


class InventoryCount(SyncModel):
    session = models.ForeignKey(InventorySession, on_delete=models.CASCADE, related_name="counts")
    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="+")
    quantity = models.IntegerField("quantité comptée")
    count_round = models.PositiveSmallIntegerField("tour de comptage", default=1)
    location = models.CharField("emplacement", max_length=50, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    counted_at = models.DateTimeField("compté le")

    class Meta:
        ordering = ["counted_at"]


class InventoryLine(models.Model):
    """Résultat validé par article : écart et valeur de l'écart (base du rapport définitif)."""

    session = models.ForeignKey(InventorySession, on_delete=models.CASCADE, related_name="lines")
    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="+")
    theoretical = models.IntegerField("théorique au gel")
    movements_during = models.IntegerField("mouvements pendant l'inventaire")
    expected = models.IntegerField("attendu")
    counted = models.IntegerField("compté", null=True)
    variance = models.IntegerField("écart")
    unit_cost = models.BigIntegerField("CMP")
    variance_value = models.BigIntegerField("valeur de l'écart")

    class Meta:
        ordering = ["article__name"]
