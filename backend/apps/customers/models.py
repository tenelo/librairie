from django.db import models

from apps.core.models import SyncModel


class School(SyncModel):
    """Établissement scolaire : un même niveau peut avoir une liste de fournitures différente selon l'école."""

    name = models.CharField("nom", max_length=150)
    city = models.CharField("ville", max_length=100, default="Abidjan")
    district = models.CharField("commune / quartier", max_length=100, blank=True)
    phone = models.CharField("téléphone", max_length=50, blank=True)
    is_active = models.BooleanField("actif", default=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "établissement scolaire"
        verbose_name_plural = "établissements scolaires"
        constraints = [
            models.UniqueConstraint(
                fields=["name", "city"], condition=models.Q(is_deleted=False), name="unique_school_name_city"
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.city})" if self.city else self.name


class Customer(SyncModel):
    """Client de la librairie (vente au comptoir ou compte boutique en ligne)."""

    name = models.CharField("nom", max_length=150)
    phone = models.CharField("téléphone", max_length=20, blank=True, db_index=True)
    email = models.EmailField("e-mail", blank=True)
    address = models.CharField("adresse", max_length=255, blank=True)
    school = models.ForeignKey(School, verbose_name="établissement", on_delete=models.SET_NULL, null=True, blank=True,
                               related_name="customers")
    user = models.OneToOneField("accounts.User", verbose_name="compte boutique", on_delete=models.SET_NULL,
                                null=True, blank=True, related_name="customer")
    credit_limit = models.PositiveBigIntegerField("plafond de crédit (FCFA)", default=0)
    notes = models.TextField("remarques", blank=True)
    is_active = models.BooleanField("actif", default=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "client"

    def __str__(self):
        return f"{self.name} ({self.phone})" if self.phone else self.name
