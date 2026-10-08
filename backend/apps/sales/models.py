"""Ventes au comptoir, paiements, caisses, retours, avoirs, bons d'achat, crédit et fidélité.

Les ventes sont créées sur le terminal (hors connexion possible) avec un UUID et un numéro de reçu
`{CODE_TERMINAL}-{AAAAMMJJ}-{séquence}` générés localement ; le serveur recalcule et vérifie tout.
"""
from django.conf import settings
from django.db import models

from apps.core.models import SyncModel


class PaymentMethod(SyncModel):
    class Kind(models.TextChoices):
        CASH = "CASH", "Espèces"
        MOBILE_MONEY = "MOBILE_MONEY", "Mobile Money"
        CARD = "CARD", "Carte bancaire"
        CREDIT = "CREDIT", "Crédit client"
        VOUCHER = "VOUCHER", "Bon d'achat"
        CREDIT_NOTE = "CREDIT_NOTE", "Avoir"
        DEPOSIT = "DEPOSIT", "Acompte en ligne"

    code = models.CharField("code", max_length=20, unique=True)
    label = models.CharField("libellé", max_length=50)
    kind = models.CharField("type", max_length=15, choices=Kind.choices)
    requires_reference = models.BooleanField("référence de transaction obligatoire", default=False)
    is_active = models.BooleanField("actif", default=True)
    sort_order = models.PositiveIntegerField("ordre", default=0)

    class Meta:
        ordering = ["sort_order", "label"]
        verbose_name = "moyen de paiement"
        verbose_name_plural = "moyens de paiement"

    def __str__(self):
        return self.label


class CashSession(SyncModel):
    """Session de caisse d'un terminal : fond de caisse, mouvements d'espèces, clôture et rapport Z."""

    class Status(models.TextChoices):
        OPEN = "OPEN", "Ouverte"
        CLOSED = "CLOSED", "Clôturée"

    # Le terminal est le champ `device` hérité de SyncModel (obligatoire pour une session).
    depot = models.ForeignKey("stock.Depot", on_delete=models.PROTECT, related_name="+")
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.OPEN)
    opened_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    opened_at = models.DateTimeField("ouverte le")
    opening_float = models.PositiveBigIntegerField("fond de caisse")
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
                                  related_name="+")
    closed_at = models.DateTimeField("clôturée le", null=True, blank=True)
    counted_cash = models.BigIntegerField("espèces comptées", null=True, blank=True)
    denominations = models.JSONField("comptage billets et pièces", default=dict, blank=True)
    expected_cash = models.BigIntegerField("espèces attendues", null=True, blank=True)
    variance = models.BigIntegerField("écart", null=True, blank=True)
    z_number = models.CharField("numéro de rapport Z", max_length=40, blank=True)
    notes = models.TextField("remarques", blank=True)

    class Meta:
        ordering = ["-opened_at"]
        verbose_name = "session de caisse"
        verbose_name_plural = "sessions de caisse"


class CashMovement(SyncModel):
    class Kind(models.TextChoices):
        IN = "IN", "Entrée d'espèces"
        OUT = "OUT", "Sortie d'espèces"

    session = models.ForeignKey(CashSession, on_delete=models.CASCADE, related_name="movements")
    kind = models.CharField("type", max_length=3, choices=Kind.choices)
    amount = models.PositiveBigIntegerField("montant")
    reason = models.CharField("justification", max_length=255)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    occurred_at = models.DateTimeField("date")

    class Meta:
        ordering = ["occurred_at"]


class Sale(SyncModel):
    class Status(models.TextChoices):
        COMPLETED = "COMPLETED", "Validée"
        CANCELLED = "CANCELLED", "Annulée"

    class Channel(models.TextChoices):
        COUNTER = "COUNTER", "Comptoir"
        ONLINE = "ONLINE", "Commande en ligne"

    receipt_number = models.CharField("numéro de reçu", max_length=40, unique=True)
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.COMPLETED)
    channel = models.CharField("canal", max_length=10, choices=Channel.choices, default=Channel.COUNTER)
    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, null=True, blank=True,
                                 related_name="sales")
    cashier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sales")
    depot = models.ForeignKey("stock.Depot", on_delete=models.PROTECT, related_name="+")
    cash_session = models.ForeignKey(CashSession, on_delete=models.PROTECT, null=True, blank=True,
                                     related_name="sales")
    sold_at = models.DateTimeField("date de vente", db_index=True)
    subtotal = models.BigIntegerField("total brut")
    discount_total = models.BigIntegerField("remises", default=0)
    total = models.BigIntegerField("total à payer")
    paid_total = models.BigIntegerField("total encaissé")
    change_due = models.BigIntegerField("monnaie rendue", default=0)
    discount_authorized_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True,
                                               blank=True, related_name="+")
    reprint_count = models.PositiveIntegerField("réimpressions", default=0)
    loyalty_points = models.IntegerField("points de fidélité gagnés", default=0)
    notes = models.CharField("note", max_length=255, blank=True)

    class Meta:
        ordering = ["-sold_at"]
        verbose_name = "vente"

    def __str__(self):
        return self.receipt_number


class SaleLine(SyncModel):
    class PriceKind(models.TextChoices):
        RETAIL = "RETAIL", "Détail"
        WHOLESALE = "WHOLESALE", "Gros"

    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="lines")
    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="sale_lines")
    description = models.CharField("désignation", max_length=200)
    quantity = models.PositiveIntegerField("quantité")
    unit_price = models.BigIntegerField("prix unitaire")
    price_kind = models.CharField("tarif", max_length=10, choices=PriceKind.choices, default=PriceKind.RETAIL)
    discount = models.BigIntegerField("remise ligne", default=0)
    line_total = models.BigIntegerField("montant")
    unit_cost = models.BigIntegerField("coût unitaire (CMP)", default=0)
    kit_adjustments = models.JSONField("personnalisation du kit", default=list, blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "created_at"]


class CreditNote(SyncModel):
    """Avoir client (issu d'un retour), utilisable comme moyen de paiement."""

    number = models.CharField("numéro", max_length=40, unique=True)
    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, null=True, blank=True,
                                 related_name="credit_notes")
    amount = models.BigIntegerField("montant")
    remaining = models.BigIntegerField("solde")
    expires_at = models.DateField("valable jusqu'au", null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "avoir"


class Voucher(SyncModel):
    """Bon d'achat (vendu ou offert), utilisable comme moyen de paiement."""

    code = models.CharField("code", max_length=30, unique=True)
    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, null=True, blank=True,
                                 related_name="vouchers")
    amount = models.BigIntegerField("montant")
    remaining = models.BigIntegerField("solde")
    expires_at = models.DateField("valable jusqu'au", null=True, blank=True)
    is_active = models.BooleanField("actif", default=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "bon d'achat"
        verbose_name_plural = "bons d'achat"


class Payment(SyncModel):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="payments")
    method = models.ForeignKey(PaymentMethod, on_delete=models.PROTECT, related_name="+")
    amount = models.BigIntegerField("montant")
    reference = models.CharField("référence de transaction", max_length=60, blank=True)
    voucher = models.ForeignKey(Voucher, on_delete=models.PROTECT, null=True, blank=True, related_name="payments")
    credit_note = models.ForeignKey(CreditNote, on_delete=models.PROTECT, null=True, blank=True,
                                    related_name="payments")

    class Meta:
        ordering = ["created_at"]


class SaleReturn(SyncModel):
    class RefundMode(models.TextChoices):
        CASH = "CASH", "Remboursement en espèces"
        CREDIT_NOTE = "CREDIT_NOTE", "Avoir"

    number = models.CharField("numéro", max_length=40, unique=True)
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="returns")
    refund_mode = models.CharField("remboursement", max_length=12, choices=RefundMode.choices)
    total = models.BigIntegerField("montant remboursé")
    reason = models.CharField("motif", max_length=255)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    authorized_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    cash_session = models.ForeignKey(CashSession, on_delete=models.PROTECT, null=True, blank=True,
                                     related_name="returns")
    credit_note = models.OneToOneField(CreditNote, on_delete=models.PROTECT, null=True, blank=True,
                                       related_name="source_return")
    returned_at = models.DateTimeField("date")

    class Meta:
        ordering = ["-returned_at"]
        verbose_name = "retour client"


class SaleReturnLine(SyncModel):
    sale_return = models.ForeignKey(SaleReturn, on_delete=models.CASCADE, related_name="lines")
    sale_line = models.ForeignKey(SaleLine, on_delete=models.PROTECT, related_name="return_lines")
    quantity = models.PositiveIntegerField("quantité")
    amount = models.BigIntegerField("montant")


class CustomerAccountEntry(SyncModel):
    """Compte client : ventes à crédit (+) et règlements (−). Solde = somme des écritures."""

    class Kind(models.TextChoices):
        CREDIT_SALE = "CREDIT_SALE", "Vente à crédit"
        REPAYMENT = "REPAYMENT", "Règlement"

    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, related_name="account_entries")
    kind = models.CharField("type", max_length=12, choices=Kind.choices)
    amount = models.BigIntegerField("montant (signé)")
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    method = models.ForeignKey(PaymentMethod, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    reference = models.CharField("référence", max_length=60, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    cash_session = models.ForeignKey(CashSession, on_delete=models.PROTECT, null=True, blank=True,
                                     related_name="repayments")

    class Meta:
        ordering = ["-created_at"]


class LoyaltyEntry(SyncModel):
    """Points de fidélité : gagnés par achat (+), convertis en remise (−)."""

    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, related_name="loyalty_entries")
    points = models.IntegerField("points")
    reason = models.CharField("motif", max_length=100)
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ["-created_at"]
