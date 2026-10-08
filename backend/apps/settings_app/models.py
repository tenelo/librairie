from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import SyncModel


class LibrarySettings(SyncModel):
    """Paramètres uniques de la librairie (en-tête des reçus, délais, synchronisation…).

    Modèle synchronisable : les terminaux en reçoivent une copie pour imprimer les reçus
    et appliquer les règles (durée hors ligne) sans connexion.
    """

    name = models.CharField("nom de la librairie", max_length=150, default="Ma Librairie")
    logo = models.ImageField("logo", upload_to="settings/", blank=True)
    address = models.CharField("adresse", max_length=255, blank=True)
    city = models.CharField("ville", max_length=100, default="Abidjan")
    phone = models.CharField("téléphone", max_length=50, blank=True)
    email = models.EmailField("e-mail", blank=True)
    website = models.CharField("site web", max_length=150, blank=True)
    taxpayer_number = models.CharField("numéro de compte contribuable", max_length=50, blank=True)
    trade_register = models.CharField("RCCM", max_length=50, blank=True)
    receipt_header = models.TextField("en-tête du reçu", blank=True)
    receipt_footer = models.TextField("pied de page du reçu", default="Merci de votre visite !", blank=True)
    vat_enabled = models.BooleanField("TVA activée", default=False)
    default_vat_rate = models.DecimalField(
        "taux de TVA par défaut (%)",
        max_digits=5,
        decimal_places=2,
        default=Decimal("18.00"),
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    offline_max_hours = models.PositiveIntegerField(
        "durée maximale hors ligne (h)", default=72, validators=[MinValueValidator(1), MaxValueValidator(24 * 30)]
    )
    order_expiry_hours = models.PositiveIntegerField(
        "délai de retrait des commandes (h)", default=72, validators=[MinValueValidator(1)]
    )
    sync_interval_minutes = models.PositiveIntegerField(
        "intervalle de synchronisation (min)", default=5, validators=[MinValueValidator(1), MaxValueValidator(120)]
    )
    loyalty_points_per_1000 = models.PositiveIntegerField("points de fidélité par tranche de 1 000 FCFA", default=1)
    loyalty_point_value = models.PositiveIntegerField("valeur d'un point de fidélité (FCFA)", default=10)
    price_rounding = models.PositiveIntegerField(
        "arrondi des prix calculés (FCFA)",
        default=5,
        choices=[(1, "1 FCFA"), (5, "5 FCFA"), (10, "10 FCFA"), (25, "25 FCFA"), (50, "50 FCFA"), (100, "100 FCFA")],
        help_text="Les prix calculés (kits, substitutions) sont arrondis à ce multiple.",
    )

    class Meta:
        verbose_name = "paramètres de la librairie"
        verbose_name_plural = "paramètres de la librairie"

    def __str__(self):
        return self.name

    @classmethod
    def load(cls):
        """Retourne l'unique instance, créée avec les valeurs par défaut si besoin."""
        instance = cls.all_objects.order_by("created_at").first()
        if instance is None:
            instance = cls()
            instance.save()
        return instance
