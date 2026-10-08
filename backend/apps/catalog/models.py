"""Catalogue : articles (simples, kits, lots, services), catégories, codes-barres et kits scolaires."""
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction

from apps.core.models import SyncModel


class Category(SyncModel):
    """Catégorie arborescente (Cahiers › Petits cahiers…)."""

    name = models.CharField("nom", max_length=100)
    parent = models.ForeignKey(
        "self", verbose_name="catégorie parente", on_delete=models.PROTECT, null=True, blank=True,
        related_name="children",
    )
    sort_order = models.PositiveIntegerField("ordre", default=0)
    is_active = models.BooleanField("active", default=True)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name = "catégorie"
        constraints = [
            models.UniqueConstraint(
                fields=["parent", "name"], condition=models.Q(is_deleted=False), name="unique_category_per_parent"
            )
        ]

    def __str__(self):
        return self.path

    @property
    def path(self) -> str:
        parts, node, seen = [], self, set()
        while node is not None and node.pk not in seen:
            seen.add(node.pk)
            parts.append(node.name)
            node = node.parent
        return " › ".join(reversed(parts))

    def descendant_ids(self) -> list:
        """Identifiants de la catégorie et de toutes ses sous-catégories (parcours en largeur)."""
        ids, frontier = [self.pk], [self.pk]
        while frontier:
            frontier = list(Category.objects.filter(parent_id__in=frontier).values_list("pk", flat=True))
            frontier = [pk for pk in frontier if pk not in ids]
            ids.extend(frontier)
        return ids

    def clean(self):
        node = self.parent
        while node is not None:
            if node.pk == self.pk:
                raise ValidationError({"parent": "Une catégorie ne peut pas être sa propre ancêtre."})
            node = node.parent


class Brand(SyncModel):
    name = models.CharField("nom", max_length=100, unique=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "marque"

    def __str__(self):
        return self.name


class Unit(SyncModel):
    code = models.CharField("code", max_length=10, unique=True)
    label = models.CharField("libellé", max_length=50)

    class Meta:
        ordering = ["label"]
        verbose_name = "unité"

    def __str__(self):
        return self.label


class Article(SyncModel):
    """Article du catalogue. Tous les montants sont en FCFA entiers."""

    class Type(models.TextChoices):
        SIMPLE = "SIMPLE", "Article simple"
        KIT = "KIT", "Kit"
        LOT = "LOT", "Lot / conditionnement"
        SERVICE = "SERVICE", "Service"

    code = models.CharField("code interne", max_length=30, unique=True)
    name = models.CharField("désignation", max_length=200, db_index=True)
    description = models.TextField("description", blank=True)
    type = models.CharField("type", max_length=10, choices=Type.choices, default=Type.SIMPLE)
    category = models.ForeignKey(
        Category, verbose_name="catégorie", on_delete=models.PROTECT, null=True, blank=True, related_name="articles"
    )
    brand = models.ForeignKey(
        Brand, verbose_name="marque", on_delete=models.PROTECT, null=True, blank=True, related_name="articles"
    )
    unit = models.ForeignKey(Unit, verbose_name="unité", on_delete=models.PROTECT, null=True, blank=True)

    # Prix (FCFA). Le CMP est recalculé à chaque réception (phase stock et achats).
    avg_cost = models.PositiveBigIntegerField("prix d'achat moyen pondéré", default=0)
    retail_price = models.PositiveBigIntegerField("prix de vente détail", default=0)
    wholesale_price = models.PositiveBigIntegerField("prix de vente gros", null=True, blank=True)
    wholesale_min_qty = models.PositiveIntegerField("quantité minimale pour le prix de gros", null=True, blank=True)
    vat_rate = models.DecimalField(
        "taux de TVA (%)", max_digits=5, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
        help_text="Vide : taux par défaut de la librairie.",
    )
    vat_exempt = models.BooleanField("exonéré de TVA", default=False)

    alert_threshold = models.PositiveIntegerField("seuil d'alerte", default=0)
    max_stock = models.PositiveIntegerField("stock maximum", null=True, blank=True)
    is_active = models.BooleanField("actif", default=True)
    is_online = models.BooleanField("visible en boutique en ligne", default=False)

    # Conditionnement (type LOT) : un lot contient N unités d'un article simple.
    lot_base_article = models.ForeignKey(
        "self", verbose_name="article contenu", on_delete=models.PROTECT, null=True, blank=True,
        related_name="lots", limit_choices_to={"type": "SIMPLE"},
    )
    lot_units = models.PositiveIntegerField("unités par lot", null=True, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "article"

    def __str__(self):
        return f"{self.code} — {self.name}"

    @property
    def tracks_stock(self) -> bool:
        """Un service n'a pas de stock ; un lot est suivi dans l'unité de son article de base."""
        return self.type in (self.Type.SIMPLE, self.Type.KIT)

    @property
    def margin(self) -> int:
        return int(self.retail_price) - int(self.avg_cost)

    def clean(self):
        errors = {}
        if self.type == self.Type.LOT:
            if not self.lot_base_article_id:
                errors["lot_base_article"] = "Un lot doit indiquer l'article qu'il contient."
            elif self.lot_base_article.type != self.Type.SIMPLE:
                errors["lot_base_article"] = "Un lot ne peut contenir qu'un article simple."
            if not self.lot_units or self.lot_units < 2:
                errors["lot_units"] = "Un lot contient au moins 2 unités."
        if (self.wholesale_price is None) != (self.wholesale_min_qty is None):
            errors["wholesale_min_qty"] = "Le prix de gros et son seuil de quantité vont ensemble."
        if self.wholesale_min_qty is not None and self.wholesale_min_qty < 2:
            errors["wholesale_min_qty"] = "Le seuil de gros doit être d'au moins 2."
        if errors:
            raise ValidationError(errors)


def article_image_path(instance, filename):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"articles/{instance.article_id}/{instance.id}.{extension}"


class ArticleImage(SyncModel):
    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField("photo", upload_to=article_image_path)
    sort_order = models.PositiveIntegerField("ordre", default=0)

    class Meta:
        ordering = ["sort_order", "created_at"]
        verbose_name = "photo d'article"


class Barcode(SyncModel):
    class Kind(models.TextChoices):
        EAN13 = "EAN13", "EAN-13 fabricant"
        INTERNAL = "INTERNAL", "Code interne (EAN-13 magasin)"
        OTHER = "OTHER", "Autre"

    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="barcodes")
    code = models.CharField("code-barres", max_length=64)
    kind = models.CharField("type", max_length=10, choices=Kind.choices, default=Kind.EAN13)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "code-barres"
        constraints = [
            models.UniqueConstraint(fields=["code"], condition=models.Q(is_deleted=False), name="unique_live_barcode")
        ]

    def __str__(self):
        return self.code


class SchoolLevel(SyncModel):
    """Référentiel des niveaux scolaires (modifiable), avec séries éventuelles au lycée."""

    class Cycle(models.TextChoices):
        PRIMAIRE = "PRIMAIRE", "Primaire"
        COLLEGE = "COLLEGE", "Collège"
        LYCEE = "LYCEE", "Lycée"

    code = models.CharField("code", max_length=20, unique=True)
    label = models.CharField("libellé", max_length=50)
    cycle = models.CharField("cycle", max_length=10, choices=Cycle.choices)
    series = models.CharField("série", max_length=5, blank=True)
    sort_order = models.PositiveIntegerField("ordre", default=0)
    is_active = models.BooleanField("actif", default=True)

    class Meta:
        ordering = ["sort_order", "code"]
        verbose_name = "niveau scolaire"
        verbose_name_plural = "niveaux scolaires"

    def __str__(self):
        return self.label


class SchoolYear(SyncModel):
    label = models.CharField("année scolaire", max_length=20, unique=True, help_text="Ex. 2026-2027")
    starts_on = models.DateField("début")
    ends_on = models.DateField("fin")
    is_current = models.BooleanField("année en cours", default=False)

    class Meta:
        ordering = ["-starts_on"]
        verbose_name = "année scolaire"
        verbose_name_plural = "années scolaires"

    def __str__(self):
        return self.label

    def clean(self):
        if self.starts_on and self.ends_on and self.ends_on <= self.starts_on:
            raise ValidationError({"ends_on": "La fin doit être postérieure au début."})

    def save(self, *args, **kwargs):
        with transaction.atomic():
            if self.is_current:
                # Une seule année en cours : les autres sont désactivées (et resynchronisées).
                for other in SchoolYear.objects.filter(is_current=True).exclude(pk=self.pk):
                    other.is_current = False
                    other.save(update_fields=["is_current"])
            super().save(*args, **kwargs)

    @classmethod
    def current(cls):
        return cls.objects.filter(is_current=True).first()


class Kit(SyncModel):
    """Définition d'un kit scolaire, rattachée à un article de type KIT (qui porte code, nom et prix)."""

    class PricingMode(models.TextChoices):
        FIXED = "FIXED", "Prix fixé manuellement"
        COMPUTED = "COMPUTED", "Somme des composants avec remise"

    class StockMode(models.TextChoices):
        VIRTUAL = "VIRTUAL", "Kit virtuel (stock des composants)"
        ASSEMBLED = "ASSEMBLED", "Kit pré-assemblé (stock propre)"

    article = models.OneToOneField(Article, on_delete=models.CASCADE, related_name="kit")
    level = models.ForeignKey(SchoolLevel, verbose_name="niveau", on_delete=models.PROTECT, related_name="kits")
    school = models.ForeignKey(
        "customers.School", verbose_name="établissement", on_delete=models.PROTECT, null=True, blank=True,
        related_name="kits",
    )
    school_year = models.ForeignKey(
        SchoolYear, verbose_name="année scolaire", on_delete=models.PROTECT, null=True, blank=True,
        related_name="kits",
    )
    pricing_mode = models.CharField("mode de prix", max_length=10, choices=PricingMode.choices,
                                    default=PricingMode.COMPUTED)
    discount_percent = models.DecimalField(
        "remise kit (%)", max_digits=5, decimal_places=2, default=Decimal("0"),
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    stock_mode = models.CharField("gestion du stock", max_length=10, choices=StockMode.choices,
                                  default=StockMode.VIRTUAL)
    notes = models.TextField("remarques", blank=True)

    class Meta:
        ordering = ["level__sort_order", "article__name"]
        verbose_name = "kit scolaire"
        verbose_name_plural = "kits scolaires"

    def __str__(self):
        return self.article.name


class KitComponent(SyncModel):
    kit = models.ForeignKey(Kit, on_delete=models.CASCADE, related_name="components")
    article = models.ForeignKey(Article, verbose_name="article", on_delete=models.PROTECT, related_name="+")
    quantity = models.PositiveIntegerField("quantité", default=1, validators=[MinValueValidator(1)])
    is_optional = models.BooleanField("facultatif", default=False)
    sort_order = models.PositiveIntegerField("ordre", default=0)
    substitutes = models.ManyToManyField(
        Article, verbose_name="équivalents autorisés", blank=True, related_name="substitute_for"
    )

    class Meta:
        ordering = ["sort_order", "created_at"]
        verbose_name = "composant de kit"
        constraints = [
            models.UniqueConstraint(
                fields=["kit", "article"], condition=models.Q(is_deleted=False), name="unique_kit_component"
            )
        ]

    def __str__(self):
        return f"{self.quantity} × {self.article.name}"


class PriceHistory(models.Model):
    """Historique des changements de prix (non synchronisé : consultation en ligne)."""

    article = models.ForeignKey(Article, on_delete=models.CASCADE, related_name="price_history")
    field = models.CharField("champ", max_length=30)
    old_value = models.CharField("ancienne valeur", max_length=30, blank=True)
    new_value = models.CharField("nouvelle valeur", max_length=30, blank=True)
    reason = models.CharField("motif", max_length=100, blank=True)
    changed_by = models.ForeignKey(
        "accounts.User", verbose_name="modifié par", on_delete=models.SET_NULL, null=True, blank=True
    )
    changed_at = models.DateTimeField("date", auto_now_add=True)

    class Meta:
        ordering = ["-changed_at"]
        verbose_name = "historique de prix"
