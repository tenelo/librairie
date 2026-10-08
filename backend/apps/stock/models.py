"""Stock : dépôts, journal des mouvements (ajout seul) et niveaux de stock calculés.

Principe central (mode hors connexion) : le stock n'est jamais écrasé par une valeur absolue.
Chaque opération produit un mouvement signé ; le stock d'un article dans un dépôt est la somme
de ses mouvements. Deux caisses hors ligne qui vendent le même article ne se contredisent donc
pas : leurs mouvements s'additionnent à la synchronisation.
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import SyncModel


class Depot(SyncModel):
    class Kind(models.TextChoices):
        BOUTIQUE = "BOUTIQUE", "Magasin / boutique"
        RESERVE = "RESERVE", "Réserve"

    code = models.CharField("code", max_length=10, unique=True)
    name = models.CharField("nom", max_length=100)
    kind = models.CharField("type", max_length=10, choices=Kind.choices, default=Kind.BOUTIQUE)
    address = models.CharField("adresse", max_length=255, blank=True)
    is_pickup_point = models.BooleanField("point de retrait des commandes en ligne", default=False)
    is_default = models.BooleanField("dépôt par défaut", default=False)
    is_active = models.BooleanField("actif", default=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "dépôt"

    def __str__(self):
        return f"{self.code} — {self.name}"

    def save(self, *args, **kwargs):
        self.code = (self.code or "").strip().upper()
        super().save(*args, **kwargs)
        if self.is_default:
            for other in Depot.objects.filter(is_default=True).exclude(pk=self.pk):
                other.is_default = False
                other.save(update_fields=["is_default"])

    @classmethod
    def default(cls):
        return cls.objects.filter(is_default=True, is_active=True).first() or cls.objects.filter(
            is_active=True).order_by("code").first()


class Location(SyncModel):
    """Emplacement (rayon, étagère) dans un dépôt ; sert au tri des listes de préparation."""

    depot = models.ForeignKey(Depot, on_delete=models.PROTECT, related_name="locations")
    code = models.CharField("code", max_length=20)
    label = models.CharField("libellé", max_length=100, blank=True)
    sort_order = models.PositiveIntegerField("ordre de passage", default=0)

    class Meta:
        ordering = ["depot", "sort_order", "code"]
        verbose_name = "emplacement"
        constraints = [
            models.UniqueConstraint(fields=["depot", "code"], condition=models.Q(is_deleted=False),
                                    name="unique_location_per_depot")
        ]

    def __str__(self):
        return f"{self.depot.code}/{self.code}"


class StockMovement(SyncModel):
    """Mouvement de stock : journal en ajout seul, jamais modifié (une erreur se corrige par un contre-mouvement).

    `quantity` est signée et exprimée dans l'unité de l'article suivi en stock (un lot vendu est
    converti en unités de son article de base). Les mouvements de réservation n'affectent pas le
    stock physique mais la quantité réservée.
    """

    class Kind(models.TextChoices):
        PURCHASE = "PURCHASE", "Réception fournisseur"
        SALE = "SALE", "Vente"
        CUSTOMER_RETURN = "CUSTOMER_RETURN", "Retour client"
        SUPPLIER_RETURN = "SUPPLIER_RETURN", "Retour fournisseur"
        ADJUSTMENT = "ADJUSTMENT", "Ajustement d'inventaire"
        LOSS = "LOSS", "Perte / casse"
        TRANSFER_OUT = "TRANSFER_OUT", "Transfert sortant"
        TRANSFER_IN = "TRANSFER_IN", "Transfert entrant"
        ASSEMBLY_IN = "ASSEMBLY_IN", "Assemblage (kit produit)"
        ASSEMBLY_OUT = "ASSEMBLY_OUT", "Assemblage (composant consommé)"
        DISASSEMBLY_IN = "DISASSEMBLY_IN", "Désassemblage (composant récupéré)"
        DISASSEMBLY_OUT = "DISASSEMBLY_OUT", "Désassemblage (kit défait)"
        RESERVATION = "RESERVATION", "Réservation commande en ligne"
        RESERVATION_RELEASE = "RESERVATION_RELEASE", "Libération de réservation"
        OPENING = "OPENING", "Stock initial"

    # Sens attendu de la quantité pour chaque type (+1 entrée, −1 sortie, 0 libre).
    DIRECTION = {
        Kind.PURCHASE: 1, Kind.SALE: -1, Kind.CUSTOMER_RETURN: 1, Kind.SUPPLIER_RETURN: -1,
        Kind.ADJUSTMENT: 0, Kind.LOSS: -1, Kind.TRANSFER_OUT: -1, Kind.TRANSFER_IN: 1,
        Kind.ASSEMBLY_IN: 1, Kind.ASSEMBLY_OUT: -1, Kind.DISASSEMBLY_IN: 1, Kind.DISASSEMBLY_OUT: -1,
        Kind.RESERVATION: 1, Kind.RESERVATION_RELEASE: -1, Kind.OPENING: 1,
    }
    RESERVATION_KINDS = (Kind.RESERVATION, Kind.RESERVATION_RELEASE)

    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="stock_movements")
    depot = models.ForeignKey(Depot, on_delete=models.PROTECT, related_name="movements")
    kind = models.CharField("type", max_length=20, choices=Kind.choices, db_index=True)
    quantity = models.IntegerField("quantité")
    unit_cost = models.PositiveBigIntegerField("coût unitaire (FCFA)", default=0)
    source_type = models.CharField("origine", max_length=40, blank=True)
    source_id = models.CharField("identifiant d'origine", max_length=64, blank=True, db_index=True)
    reference = models.CharField("référence", max_length=60, blank=True)
    reason = models.CharField("motif", max_length=255, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name="utilisateur", on_delete=models.SET_NULL,
                             null=True, blank=True, related_name="+")
    occurred_at = models.DateTimeField("date", db_index=True)

    class Meta:
        ordering = ["-occurred_at", "-created_at"]
        verbose_name = "mouvement de stock"
        verbose_name_plural = "mouvements de stock"
        indexes = [models.Index(fields=["article", "depot", "occurred_at"])]

    def __str__(self):
        return f"{self.get_kind_display()} {self.quantity:+d} {self.article_id} @ {self.depot_id}"

    @property
    def is_reservation(self):
        return self.kind in self.RESERVATION_KINDS

    def clean(self):
        direction = self.DIRECTION.get(self.kind, 0)
        if self.quantity == 0:
            raise ValidationError({"quantity": "Un mouvement ne peut pas être nul."})
        if direction and (self.quantity > 0) != (direction > 0):
            raise ValidationError({"quantity": f"Signe incohérent pour « {self.get_kind_display()} »."})

    def save(self, *args, **kwargs):
        if not self._state.adding and not kwargs.get("update_fields"):
            raise ValidationError("Un mouvement de stock ne peut pas être modifié : passez un contre-mouvement.")
        super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError("Un mouvement de stock ne peut pas être supprimé : passez un contre-mouvement.")


class StockLevel(SyncModel):
    """Projection du journal : stock physique et réservé par article et par dépôt.

    Mise à jour à chaque mouvement (incrément atomique) ; la commande `rebuild_stock_levels`
    la reconstruit intégralement à partir des mouvements.
    """

    article = models.ForeignKey("catalog.Article", on_delete=models.CASCADE, related_name="stock_levels")
    depot = models.ForeignKey(Depot, on_delete=models.CASCADE, related_name="stock_levels")
    quantity = models.IntegerField("stock physique", default=0)
    reserved = models.IntegerField("réservé", default=0)
    location = models.ForeignKey(Location, verbose_name="emplacement", on_delete=models.SET_NULL, null=True,
                                 blank=True, related_name="+")

    class Meta:
        verbose_name = "niveau de stock"
        constraints = [models.UniqueConstraint(fields=["article", "depot"], name="unique_stock_level")]

    @property
    def available(self):
        return self.quantity - self.reserved


class StockAlert(SyncModel):
    """Alerte de stock bas ou de rupture (stock disponible tous dépôts confondus)."""

    class Kind(models.TextChoices):
        LOW = "LOW", "Stock bas"
        OUT = "OUT", "Rupture"

    article = models.ForeignKey("catalog.Article", on_delete=models.CASCADE, related_name="stock_alerts")
    kind = models.CharField("type", max_length=5, choices=Kind.choices)
    available = models.IntegerField("disponible au déclenchement")
    threshold = models.IntegerField("seuil")
    resolved_at = models.DateTimeField("résolue le", null=True, blank=True)

    class Meta:
        ordering = ["resolved_at", "-created_at"]
        verbose_name = "alerte de stock"


class StockTransfer(SyncModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Brouillon"
        VALIDATED = "VALIDATED", "Validé"
        CANCELLED = "CANCELLED", "Annulé"

    number = models.CharField("numéro", max_length=30, unique=True)
    from_depot = models.ForeignKey(Depot, verbose_name="dépôt de départ", on_delete=models.PROTECT,
                                   related_name="transfers_out")
    to_depot = models.ForeignKey(Depot, verbose_name="dépôt d'arrivée", on_delete=models.PROTECT,
                                 related_name="transfers_in")
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.DRAFT)
    note = models.TextField("note", blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+")
    validated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="+")
    validated_at = models.DateTimeField("validé le", null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "transfert de stock"


class StockTransferLine(SyncModel):
    transfer = models.ForeignKey(StockTransfer, on_delete=models.CASCADE, related_name="lines")
    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="+")
    quantity = models.PositiveIntegerField("quantité")

    class Meta:
        ordering = ["created_at"]


class KitAssembly(SyncModel):
    """Assemblage (composants → kits) ou désassemblage (kits → composants) d'un kit pré-assemblé."""

    class Operation(models.TextChoices):
        ASSEMBLE = "ASSEMBLE", "Assemblage"
        DISASSEMBLE = "DISASSEMBLE", "Désassemblage"

    number = models.CharField("numéro", max_length=30, unique=True)
    kit = models.ForeignKey("catalog.Kit", on_delete=models.PROTECT, related_name="assemblies")
    depot = models.ForeignKey(Depot, on_delete=models.PROTECT, related_name="+")
    operation = models.CharField("opération", max_length=12, choices=Operation.choices)
    quantity = models.PositiveIntegerField("nombre de kits")
    note = models.CharField("note", max_length=255, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="+")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "assemblage de kits"
        verbose_name_plural = "assemblages de kits"
