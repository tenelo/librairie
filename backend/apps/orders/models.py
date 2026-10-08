"""Commandes en ligne (click & collect) : cycle de vie, lignes, historique et paiements d'acompte."""
import secrets

from django.conf import settings
from django.db import models

from apps.core.models import SyncModel


def new_pickup_code() -> str:
    """Code de retrait à 6 chiffres (imprimé avec le QR code)."""
    return f"{secrets.randbelow(10 ** 6):06d}"


class OnlineOrder(SyncModel):
    class Status(models.TextChoices):
        RECEIVED = "RECEIVED", "Reçue"
        CONFIRMED = "CONFIRMED", "Confirmée"
        PREPARING = "PREPARING", "En préparation"
        READY = "READY", "Prête"
        PICKED_UP = "PICKED_UP", "Retirée"
        CANCELLED = "CANCELLED", "Annulée"
        EXPIRED = "EXPIRED", "Expirée"

    class PaymentMode(models.TextChoices):
        ON_PICKUP = "ON_PICKUP", "Paiement au retrait"
        DEPOSIT = "DEPOSIT", "Acompte Mobile Money"

    # Statuts pendant lesquels le stock est réservé.
    RESERVING = (Status.CONFIRMED, Status.PREPARING, Status.READY)
    OPEN = (Status.RECEIVED, Status.CONFIRMED, Status.PREPARING, Status.READY)
    CUSTOMER_CANCELLABLE = (Status.RECEIVED, Status.CONFIRMED)
    TRANSITIONS = {
        Status.RECEIVED: (Status.CONFIRMED, Status.CANCELLED),
        Status.CONFIRMED: (Status.PREPARING, Status.CANCELLED),
        Status.PREPARING: (Status.READY, Status.CANCELLED),
        Status.READY: (Status.PICKED_UP, Status.CANCELLED, Status.EXPIRED),
    }

    number = models.CharField("numéro", max_length=30, unique=True)
    customer = models.ForeignKey("customers.Customer", verbose_name="client", on_delete=models.PROTECT,
                                 related_name="online_orders")
    pickup_depot = models.ForeignKey("stock.Depot", verbose_name="point de retrait", on_delete=models.PROTECT,
                                     related_name="online_orders")
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.RECEIVED,
                              db_index=True)
    pickup_slot = models.DateTimeField("créneau de retrait souhaité", null=True, blank=True)
    comment = models.TextField("commentaire du client", blank=True)
    pickup_code = models.CharField("code de retrait", max_length=6, default=new_pickup_code)
    accept_partial = models.BooleanField("accepte une commande partielle", default=False)
    awaiting_customer = models.BooleanField("en attente de l'accord du client", default=False)
    payment_mode = models.CharField("paiement", max_length=10, choices=PaymentMode.choices,
                                    default=PaymentMode.ON_PICKUP)
    total = models.PositiveBigIntegerField("total (FCFA)", default=0)
    deposit_due = models.PositiveBigIntegerField("acompte demandé (FCFA)", default=0)
    deposit_paid = models.PositiveBigIntegerField("acompte payé (FCFA)", default=0)
    parcels = models.PositiveIntegerField("nombre de colis", default=1)
    preparer = models.ForeignKey(settings.AUTH_USER_MODEL, verbose_name="préparateur", on_delete=models.SET_NULL,
                                 null=True, blank=True, related_name="+")
    sale = models.OneToOneField("sales.Sale", verbose_name="vente", on_delete=models.SET_NULL, null=True,
                                blank=True, related_name="online_order")
    confirmed_at = models.DateTimeField("confirmée le", null=True, blank=True)
    ready_at = models.DateTimeField("prête le", null=True, blank=True)
    expires_at = models.DateTimeField("expire le", null=True, blank=True, db_index=True)
    reminder_sent_at = models.DateTimeField("rappel envoyé le", null=True, blank=True)
    picked_up_at = models.DateTimeField("retirée le", null=True, blank=True)
    cancelled_at = models.DateTimeField("annulée le", null=True, blank=True)
    cancel_reason = models.CharField("motif d'annulation", max_length=255, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "commande en ligne"
        verbose_name_plural = "commandes en ligne"

    def __str__(self):
        return self.number

    @property
    def qr_payload(self) -> str:
        """Contenu du QR code de retrait, lu par la douchette à la caisse."""
        return f"CMD:{self.number}:{self.pickup_code}"

    @property
    def balance_due(self) -> int:
        return max(self.total - self.deposit_paid, 0)


class OnlineOrderLine(SyncModel):
    class Status(models.TextChoices):
        OK = "OK", "Conforme"
        PARTIAL = "PARTIAL", "Partielle"
        SUBSTITUTED = "SUBSTITUTED", "Substituée"
        UNAVAILABLE = "UNAVAILABLE", "Indisponible"

    order = models.ForeignKey(OnlineOrder, on_delete=models.CASCADE, related_name="lines")
    article = models.ForeignKey("catalog.Article", on_delete=models.PROTECT, related_name="+")
    original_article = models.ForeignKey("catalog.Article", verbose_name="article commandé à l'origine",
                                         on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    description = models.CharField("libellé", max_length=200)
    ordered_qty = models.PositiveIntegerField("quantité commandée")
    quantity = models.PositiveIntegerField("quantité retenue")
    unit_price = models.PositiveBigIntegerField("prix unitaire (FCFA)")
    line_total = models.PositiveBigIntegerField("montant (FCFA)")
    prepared_qty = models.PositiveIntegerField("quantité préparée", default=0)
    status = models.CharField("état", max_length=12, choices=Status.choices, default=Status.OK)
    # Modification proposée par la librairie en cas de rupture :
    # {"quantity": n} (quantité réduite) et/ou {"substitute": id, "substitute_name": …, "unit_price": …}.
    proposal = models.JSONField("proposition au client", default=dict, blank=True)
    sort_order = models.PositiveIntegerField("ordre", default=0)

    class Meta:
        ordering = ["sort_order"]
        verbose_name = "ligne de commande en ligne"


class OrderStatusHistory(models.Model):
    order = models.ForeignKey(OnlineOrder, on_delete=models.CASCADE, related_name="history")
    from_status = models.CharField("de", max_length=10, blank=True)
    to_status = models.CharField("vers", max_length=10)
    note = models.CharField("note", max_length=255, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="+")
    at = models.DateTimeField("date", auto_now_add=True)

    class Meta:
        ordering = ["at", "id"]
        verbose_name = "historique de commande"


class PaymentTransaction(SyncModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "En attente"
        SUCCEEDED = "SUCCEEDED", "Réussi"
        FAILED = "FAILED", "Échoué"

    order = models.ForeignKey(OnlineOrder, on_delete=models.PROTECT, related_name="payments")
    provider = models.CharField("prestataire", max_length=30)
    operator = models.CharField("opérateur", max_length=20, blank=True)
    phone = models.CharField("téléphone payeur", max_length=20, blank=True)
    amount = models.PositiveBigIntegerField("montant (FCFA)")
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.PENDING)
    external_ref = models.CharField("référence prestataire", max_length=80, unique=True)
    message = models.CharField("message", max_length=255, blank=True)
    raw = models.JSONField("données brutes", default=dict, blank=True)
    completed_at = models.DateTimeField("terminé le", null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "paiement en ligne"
