from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.customers.models import School

from .barcodes import is_valid_ean13
from .models import (
    Article,
    ArticleImage,
    Barcode,
    Brand,
    Category,
    Kit,
    KitComponent,
    PriceHistory,
    SchoolLevel,
    SchoolYear,
    Unit,
)
from .services import (
    PRICE_FIELDS,
    add_internal_barcode,
    article_availability,
    compute_kit_pricing,
    next_article_code,
    refresh_kit_price,
)

PRICE_DENIED = "La modification des prix est réservée aux rôles autorisés (permission « Modifier les prix »)."


def require_price_permission(serializer, changed: bool):
    request = serializer.context.get("request")
    if changed and request is not None and not request.user.has_app_perm("catalog.prices"):
        raise PermissionDenied(PRICE_DENIED)


class CategorySerializer(serializers.ModelSerializer):
    path = serializers.CharField(read_only=True)
    article_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Category
        fields = ["id", "name", "parent", "path", "sort_order", "is_active", "article_count", "sync_version",
                  "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]
        validators = []

    def validate(self, attrs):
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        name = attrs.get("name", getattr(self.instance, "name", ""))
        if self.instance is not None and parent is not None:
            node = parent
            while node is not None:
                if node.pk == self.instance.pk:
                    raise serializers.ValidationError({"parent": "Une catégorie ne peut pas être sa propre ancêtre."})
                node = node.parent
        siblings = Category.objects.filter(parent=parent, name__iexact=name)
        if self.instance is not None:
            siblings = siblings.exclude(pk=self.instance.pk)
        if siblings.exists():
            raise serializers.ValidationError({"name": "Cette catégorie existe déjà à cet endroit."})
        return attrs


class BrandSerializer(serializers.ModelSerializer):
    class Meta:
        model = Brand
        fields = ["id", "name", "sync_version", "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]


class UnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Unit
        fields = ["id", "code", "label", "sync_version", "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]


class BarcodeSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)
    # Unicité contrôlée par ArticleSerializer.validate_barcodes (message nommant l'article titulaire).
    code = serializers.CharField(max_length=64)

    class Meta:
        model = Barcode
        fields = ["id", "code", "kind"]


class ArticleImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ArticleImage
        fields = ["id", "image", "sort_order"]


class ArticleSerializer(serializers.ModelSerializer):
    code = serializers.CharField(max_length=30, required=False, allow_blank=True)
    category_path = serializers.CharField(source="category.path", read_only=True, default=None)
    brand_name = serializers.CharField(source="brand.name", read_only=True, default=None)
    unit_label = serializers.CharField(source="unit.label", read_only=True, default=None)
    type_label = serializers.CharField(source="get_type_display", read_only=True)
    lot_base_article_name = serializers.CharField(source="lot_base_article.name", read_only=True, default=None)
    barcodes = BarcodeSerializer(many=True, required=False)
    images = ArticleImageSerializer(many=True, read_only=True)
    kit_id = serializers.SerializerMethodField()
    margin = serializers.IntegerField(read_only=True)
    generate_barcode = serializers.BooleanField(write_only=True, required=False, default=True)

    class Meta:
        model = Article
        fields = [
            "id", "code", "name", "description", "type", "type_label",
            "category", "category_path", "brand", "brand_name", "unit", "unit_label",
            "avg_cost", "retail_price", "wholesale_price", "wholesale_min_qty", "vat_rate", "vat_exempt", "margin",
            "alert_threshold", "max_stock", "is_active", "is_online",
            "lot_base_article", "lot_base_article_name", "lot_units",
            "barcodes", "images", "kit_id", "generate_barcode", "sync_version", "updated_at",
        ]
        read_only_fields = ["sync_version", "updated_at"]

    def get_kit_id(self, obj) -> str | None:
        kit = getattr(obj, "kit", None) if obj.type == Article.Type.KIT else None
        return str(kit.pk) if kit else None

    def validate_code(self, value):
        value = (value or "").strip().upper()
        if value:
            others = Article.all_objects.filter(code__iexact=value)
            if self.instance is not None:
                others = others.exclude(pk=self.instance.pk)
            if others.exists():
                raise serializers.ValidationError("Ce code interne est déjà utilisé.")
        return value

    def validate_barcodes(self, value):
        seen = set()
        for item in value:
            code = item["code"].strip()
            item["code"] = code
            if code in seen:
                raise serializers.ValidationError(f"Le code-barres {code} est en double.")
            seen.add(code)
            if item.get("kind", Barcode.Kind.EAN13) in (Barcode.Kind.EAN13, Barcode.Kind.INTERNAL):
                if not is_valid_ean13(code):
                    raise serializers.ValidationError(f"{code} n'est pas un EAN-13 valide (13 chiffres, clé correcte).")
            taken = Barcode.objects.filter(code=code)
            if self.instance is not None:
                taken = taken.exclude(article=self.instance)
            if taken.exists():
                owner = taken.select_related("article").first().article
                raise serializers.ValidationError(f"Le code-barres {code} est déjà attribué à « {owner.name} ».")
        return value

    def validate(self, attrs):
        article_type = attrs.get("type", getattr(self.instance, "type", Article.Type.SIMPLE))
        if self.instance is not None and "type" in attrs and attrs["type"] != self.instance.type:
            raise serializers.ValidationError({"type": "Le type d'un article ne peut pas être modifié."})
        if self.instance is None and article_type == Article.Type.KIT:
            raise serializers.ValidationError({"type": "Les kits se créent depuis l'écran « Kits scolaires »."})

        if self.instance is None:
            changed = any(attrs.get(f) not in (None, 0, False) for f in PRICE_FIELDS)
        else:
            changed = any(f in attrs and attrs[f] != getattr(self.instance, f) for f in PRICE_FIELDS)
        if self.instance is not None and "avg_cost" in attrs and attrs["avg_cost"] != self.instance.avg_cost:
            raise serializers.ValidationError(
                {"avg_cost": "Le prix d'achat moyen est recalculé automatiquement à chaque réception."}
            )
        require_price_permission(self, changed)

        candidate = Article(**{k: v for k, v in attrs.items() if k not in ("barcodes", "generate_barcode")})
        if self.instance is not None:
            for name in ("type", "lot_base_article", "lot_units", "wholesale_price", "wholesale_min_qty"):
                if name not in attrs:
                    setattr(candidate, name, getattr(self.instance, name))
        candidate.type = article_type
        try:
            candidate.clean()
        except Exception as exc:  # ValidationError Django → DRF
            raise serializers.ValidationError(getattr(exc, "message_dict", {"non_field_errors": [str(exc)]}))
        if article_type != Article.Type.LOT:
            attrs["lot_base_article"] = None
            attrs["lot_units"] = None
        return attrs

    def _sync_barcodes(self, article, barcodes):
        wanted = {item["code"]: item.get("kind", Barcode.Kind.EAN13) for item in barcodes}
        for barcode in article.barcodes.all():
            if barcode.code not in wanted:
                barcode.soft_delete()
            else:
                wanted.pop(barcode.code)
        for code, kind in wanted.items():
            Barcode.objects.create(article=article, code=code, kind=kind)

    @transaction.atomic
    def create(self, validated_data):
        barcodes = validated_data.pop("barcodes", [])
        generate = validated_data.pop("generate_barcode", True)
        if not validated_data.get("code"):
            validated_data["code"] = next_article_code(validated_data.get("type", Article.Type.SIMPLE))
        article = Article.objects.create(**validated_data)
        self._sync_barcodes(article, barcodes)
        if generate and not barcodes:
            add_internal_barcode(article)
        return article

    @transaction.atomic
    def update(self, instance, validated_data):
        barcodes = validated_data.pop("barcodes", None)
        validated_data.pop("generate_barcode", None)
        if not validated_data.get("code", instance.code):
            validated_data.pop("code", None)
        for name, value in validated_data.items():
            setattr(instance, name, value)
        instance.save()
        if barcodes is not None:
            self._sync_barcodes(instance, barcodes)
        return instance


class ArticleLookupSerializer(serializers.ModelSerializer):
    """Version légère pour les listes de choix (composants de kits, étiquettes)."""

    barcode = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = ["id", "code", "name", "type", "retail_price", "avg_cost", "is_active", "barcode"]

    def get_barcode(self, obj) -> str | None:
        barcodes = [b for b in obj.barcodes.all() if not b.is_deleted]
        return barcodes[0].code if barcodes else None


class PriceHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = PriceHistory
        fields = ["id", "field", "old_value", "new_value", "reason", "changed_by_name", "changed_at"]


class SchoolLevelSerializer(serializers.ModelSerializer):
    cycle_label = serializers.CharField(source="get_cycle_display", read_only=True)

    class Meta:
        model = SchoolLevel
        fields = ["id", "code", "label", "cycle", "cycle_label", "series", "sort_order", "is_active",
                  "sync_version", "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]


class SchoolYearSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolYear
        fields = ["id", "label", "starts_on", "ends_on", "is_current", "sync_version", "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]

    def validate(self, attrs):
        starts = attrs.get("starts_on", getattr(self.instance, "starts_on", None))
        ends = attrs.get("ends_on", getattr(self.instance, "ends_on", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_on": "La fin doit être postérieure au début."})
        return attrs


# --- Kits ------------------------------------------------------------------------------------


class KitComponentSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    article = serializers.PrimaryKeyRelatedField(queryset=Article.objects.all())
    article_code = serializers.CharField(source="article.code", read_only=True)
    article_name = serializers.CharField(source="article.name", read_only=True)
    article_type = serializers.CharField(source="article.type", read_only=True)
    unit_price = serializers.IntegerField(source="article.retail_price", read_only=True)
    unit_cost = serializers.IntegerField(source="article.avg_cost", read_only=True)
    substitutes = serializers.PrimaryKeyRelatedField(queryset=Article.objects.all(), many=True, required=False)
    substitute_details = ArticleLookupSerializer(source="substitutes", many=True, read_only=True)

    class Meta:
        model = KitComponent
        fields = ["id", "article", "article_code", "article_name", "article_type", "unit_price", "unit_cost",
                  "quantity", "is_optional", "sort_order", "substitutes", "substitute_details"]

    def validate(self, attrs):
        article = attrs["article"]
        if article.type == Article.Type.KIT:
            raise serializers.ValidationError({"article": "Un kit ne peut pas contenir un autre kit."})
        for substitute in attrs.get("substitutes", []):
            if substitute.pk == article.pk:
                raise serializers.ValidationError({"substitutes": "Un article ne peut pas être son propre équivalent."})
            if substitute.type == Article.Type.KIT:
                raise serializers.ValidationError({"substitutes": "Un équivalent ne peut pas être un kit."})
        return attrs


class KitSerializer(serializers.ModelSerializer):
    """Kit et article associé, saisis ensemble. La composition est remplacée à chaque écriture."""

    article_id = serializers.UUIDField(source="article.id", read_only=True)
    code = serializers.CharField(source="article.code", required=False, allow_blank=True, max_length=30)
    name = serializers.CharField(source="article.name", max_length=200)
    description = serializers.CharField(source="article.description", required=False, allow_blank=True)
    category = serializers.PrimaryKeyRelatedField(
        source="article.category", queryset=Category.objects.all(), required=False, allow_null=True
    )
    retail_price = serializers.IntegerField(source="article.retail_price", required=False, min_value=0)
    is_active = serializers.BooleanField(source="article.is_active", required=False)
    is_online = serializers.BooleanField(source="article.is_online", required=False)
    barcodes = BarcodeSerializer(source="article.barcodes", many=True, read_only=True)
    level = serializers.PrimaryKeyRelatedField(queryset=SchoolLevel.objects.all())
    level_label = serializers.CharField(source="level.label", read_only=True)
    school = serializers.PrimaryKeyRelatedField(queryset=School.objects.all(), required=False, allow_null=True)
    school_name = serializers.CharField(source="school.name", read_only=True, default=None)
    school_year = serializers.PrimaryKeyRelatedField(
        queryset=SchoolYear.objects.all(), required=False, allow_null=True
    )
    school_year_label = serializers.CharField(source="school_year.label", read_only=True, default=None)
    components = KitComponentSerializer(many=True)
    pricing = serializers.SerializerMethodField()
    availability = serializers.SerializerMethodField()

    class Meta:
        model = Kit
        fields = [
            "id", "article_id", "code", "name", "description", "category", "retail_price", "is_active", "is_online",
            "barcodes", "level", "level_label", "school", "school_name", "school_year", "school_year_label",
            "pricing_mode", "discount_percent", "stock_mode", "notes", "components", "pricing",
            "availability", "sync_version", "updated_at",
        ]
        read_only_fields = ["sync_version", "updated_at"]

    def get_pricing(self, obj) -> dict:
        return compute_kit_pricing(obj).as_dict()

    def get_availability(self, obj) -> int:
        """Kits vendables (tous dépôts) : composant le plus limitant (virtuel) ou stock propre (pré-assemblé)."""
        from apps.stock.services import stock_lookup

        lookup = self.context.get("stock_lookup")
        if lookup is None:
            lookup = self.context["stock_lookup"] = stock_lookup()
        return article_availability(obj.article, lookup) or 0

    def validate_components(self, value):
        if not value:
            raise serializers.ValidationError("Un kit doit contenir au moins un article.")
        articles = [item["article"].pk for item in value]
        if len(articles) != len(set(articles)):
            raise serializers.ValidationError("Un même article apparaît plusieurs fois : ajustez plutôt la quantité.")
        return value

    def validate(self, attrs):
        article_data = attrs.get("article", {})
        code = (article_data.get("code") or "").strip().upper()
        if code:
            others = Article.all_objects.filter(code__iexact=code)
            if self.instance is not None:
                others = others.exclude(pk=self.instance.article_id)
            if others.exists():
                raise serializers.ValidationError({"code": "Ce code interne est déjà utilisé."})
            article_data["code"] = code

        mode = attrs.get("pricing_mode", getattr(self.instance, "pricing_mode", Kit.PricingMode.COMPUTED))
        if self.instance is None:
            changed = attrs.get("discount_percent", 0) not in (0, None) or (
                mode == Kit.PricingMode.FIXED and article_data.get("retail_price")
            )
        else:
            changed = (
                ("pricing_mode" in attrs and attrs["pricing_mode"] != self.instance.pricing_mode)
                or ("discount_percent" in attrs and attrs["discount_percent"] != self.instance.discount_percent)
                or (mode == Kit.PricingMode.FIXED and "retail_price" in article_data
                    and article_data["retail_price"] != self.instance.article.retail_price)
            )
        require_price_permission(self, changed)
        if mode == Kit.PricingMode.COMPUTED:
            # Le prix est calculé : une valeur saisie est ignorée.
            article_data.pop("retail_price", None)
        return attrs

    def _replace_components(self, kit, components):
        keep = set()
        for order, item in enumerate(components):
            substitutes = item.pop("substitutes", [])
            item.pop("id", None)
            item.setdefault("sort_order", order)
            component = KitComponent.objects.filter(kit=kit, article=item["article"]).first()
            if component is None:
                component = KitComponent.objects.create(kit=kit, **item)
            else:
                for name, value in item.items():
                    setattr(component, name, value)
                component.save()
            component.substitutes.set(substitutes)
            keep.add(component.pk)
        for component in kit.components.exclude(pk__in=keep):
            component.soft_delete()

    @transaction.atomic
    def create(self, validated_data):
        article_data = validated_data.pop("article", {})
        components = validated_data.pop("components")
        if not article_data.get("code"):
            article_data["code"] = next_article_code(Article.Type.KIT)
        article = Article.objects.create(type=Article.Type.KIT, **article_data)
        add_internal_barcode(article)
        kit = Kit.objects.create(article=article, **validated_data)
        self._replace_components(kit, components)
        refresh_kit_price(kit, user=self.context["request"].user)
        return kit

    @transaction.atomic
    def update(self, instance, validated_data):
        article_data = validated_data.pop("article", {})
        components = validated_data.pop("components", None)
        article = instance.article
        if not article_data.get("code", article.code):
            article_data.pop("code", None)
        for name, value in article_data.items():
            setattr(article, name, value)
        article.save()
        for name, value in validated_data.items():
            setattr(instance, name, value)
        instance.save()
        if components is not None:
            self._replace_components(instance, components)
        refresh_kit_price(instance, user=self.context["request"].user)
        return instance


class KitDuplicateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    level = serializers.PrimaryKeyRelatedField(queryset=SchoolLevel.objects.all(), required=False)
    school = serializers.PrimaryKeyRelatedField(queryset=School.objects.all(), required=False, allow_null=True)
    school_year = serializers.PrimaryKeyRelatedField(queryset=SchoolYear.objects.all(), required=False)


class KitCustomizeSerializer(serializers.Serializer):
    removed = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)
    substitutions = serializers.DictField(child=serializers.UUIDField(), required=False, default=dict)
