"""Achats : fournisseurs, bons de commande et réceptions de marchandises."""
from django.conf import settings
from django.db import models

from apps.core.models import SyncModel


class Supplier(SyncModel):
    name = models.CharField("raison sociale", max_length=150)
    contact_name = models.CharField("contact", max_length=100, blank=True)
    phone = models.CharField("téléphone", max_length=50, blank=True)
    email = models.EmailField("e-mail", blank=True)
    address = models.CharField("adresse", max_length=255, blank=True)
    payment_terms = models.CharField("conditions de paiement", max_length=150, blank=True,
                                     help_text="Ex. comptant, 30 jours fin de mois")
    lead_time_days = models.PositiveIntegerField("délai de livraison (jours)", default=7)
    notes = models.TextField("remarques", blank=True)
    is_active = models.BooleanField("actif", default=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "fournisseur"

    def __str__(self):
        return self.name


class SupplierArticle(SyncModel):
    """Article acheté chez un fournisseur : référence et dernier prix (mis à jour à chaque réception)."""

    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name="articles")
    article = models.ForeignKey("catalog.Article", on_delete=models.CASCADE, related_name="supplier_links")
    supplier_reference = models.CharField("référence fournisseur", max_length=60, blank=True)
    last_cost = models.PositiveBigIntegerField("dernier prix d'achat", default=0)
    last_received_at = models.DateTimeField("dernière réception", null=True, blank=True)

    class Meta:
        verbose_name = "article fournisseur"
        constraints = [models.UniqueConstraint(fields=["supplier", "article"], name="unique_supplier_article")]


class PurchaseOrder(SyncModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Brouillon"
        SENT = "SENT", "Envoyé"
        PARTIAL = "PARTIAL", "Partiellement reçu"
        RECEIVED = "RECEIVED", "Reçu"
        CANCELLED = "CANCELLED", "Annulé"

    OPEN_STATUSES = (Status.SENT, Status.PARTIAL)

    number = models.CharField("numéro", max_length=30, unique=True)
    supplier = models.ForeignKey(Supplier, verbose_name="fournisseur", on_delete=models.PROTECT,
                                 related_name="orders")
    depot = models.ForeignKey("stock.Depot", verbose_name="dépôt de livraison", on_delete=models.PROTECT,
                              related_name="+")
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.DRAFT)
    order_date = models.DateField("date de commande")
    expected_date = models.DateField("livraison prévue", null=True, blank=True)
    note = models.TextField("note", blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="+")
    sent_at = models.DateTimeField("envoyé le", null=True, blank=True)

    class Meta:
        ordering = ["-order_date", "-created_at"]
        verbose_name = "bon de commande"
        verbose_name_plural = "bons de commande"

    def __str__(self):
        return self.number

    @property
    def total(self) -> int:
        return sum(line.quantity * line.unit_cost for line in self.lines.all())


class PurchaseOrderLine(SyncModel):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="lines")
    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="+")
    quantity = models.PositiveIntegerField("quantité commandée")
    unit_cost = models.PositiveBigIntegerField("prix unitaire (FCFA)")
    received_quantity = models.PositiveIntegerField("quantité reçue", default=0)

    class Meta:
        ordering = ["created_at"]

    @property
    def remaining(self) -> int:
        return max(self.quantity - self.received_quantity, 0)


class GoodsReceipt(SyncModel):
    """Réception de marchandises (validée à l'enregistrement ; possible hors ligne via la synchronisation)."""

    number = models.CharField("numéro", max_length=30, unique=True)
    supplier = models.ForeignKey(Supplier, verbose_name="fournisseur", on_delete=models.PROTECT,
                                 related_name="receipts")
    depot = models.ForeignKey("stock.Depot", verbose_name="dépôt", on_delete=models.PROTECT, related_name="+")
    purchase_order = models.ForeignKey(PurchaseOrder, verbose_name="bon de commande", on_delete=models.PROTECT,
                                       null=True, blank=True, related_name="receipts")
    received_at = models.DateTimeField("reçu le")
    delivery_note = models.CharField("bon de livraison fournisseur", max_length=60, blank=True)
    note = models.TextField("note", blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="+")

    class Meta:
        ordering = ["-received_at"]
        verbose_name = "réception"

    def __str__(self):
        return self.number

    @property
    def total(self) -> int:
        return sum(line.quantity * line.unit_cost for line in self.lines.all())


class GoodsReceiptLine(SyncModel):
    receipt = models.ForeignKey(GoodsReceipt, on_delete=models.CASCADE, related_name="lines")
    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="+")
    order_line = models.ForeignKey(PurchaseOrderLine, on_delete=models.PROTECT, null=True, blank=True,
                                   related_name="receipt_lines")
    quantity = models.PositiveIntegerField("quantité reçue")
    unit_cost = models.PositiveBigIntegerField("prix unitaire (FCFA)")

    class Meta:
        ordering = ["created_at"]
