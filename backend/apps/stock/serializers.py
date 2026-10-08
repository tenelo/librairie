from rest_framework import serializers

from apps.catalog.models import Article, Kit

from .models import Depot, KitAssembly, Location, StockAlert, StockLevel, StockMovement, StockTransfer, StockTransferLine


class DepotSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = Depot
        fields = ["id", "code", "name", "kind", "kind_label", "address", "is_pickup_point", "is_default", "is_active",
                  "sync_version", "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]


class LocationSerializer(serializers.ModelSerializer):
    depot_code = serializers.CharField(source="depot.code", read_only=True)

    class Meta:
        model = Location
        fields = ["id", "depot", "depot_code", "code", "label", "sort_order", "sync_version", "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]
        validators = []

    def validate(self, attrs):
        depot = attrs.get("depot", getattr(self.instance, "depot", None))
        code = attrs.get("code", getattr(self.instance, "code", "")).strip().upper()
        attrs["code"] = code
        duplicates = Location.objects.filter(depot=depot, code=code)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError({"code": "Cet emplacement existe déjà dans ce dépôt."})
        return attrs


class StockLevelSerializer(serializers.ModelSerializer):
    available = serializers.IntegerField(read_only=True)
    depot_code = serializers.CharField(source="depot.code", read_only=True)
    location_code = serializers.CharField(source="location.code", read_only=True, default=None)

    class Meta:
        model = StockLevel
        fields = ["id", "article", "depot", "depot_code", "quantity", "reserved", "available", "location",
                  "location_code", "sync_version", "updated_at"]
        read_only_fields = ["article", "depot", "quantity", "reserved", "sync_version", "updated_at"]


class StockStateSerializer(serializers.ModelSerializer):
    """Ligne de l'état des stocks (annotations calculées par la vue)."""

    category_path = serializers.CharField(source="category.path", read_only=True, default=None)
    quantity = serializers.IntegerField()
    reserved = serializers.IntegerField()
    available = serializers.IntegerField()
    value = serializers.IntegerField()
    status = serializers.CharField()

    class Meta:
        model = Article
        fields = ["id", "code", "name", "type", "category_path", "alert_threshold", "max_stock", "avg_cost",
                  "retail_price", "quantity", "reserved", "available", "value", "status"]


class StockMovementSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    article_code = serializers.CharField(source="article.code", read_only=True)
    article_name = serializers.CharField(source="article.name", read_only=True)
    depot_code = serializers.CharField(source="depot.code", read_only=True)
    user_name = serializers.CharField(source="user.get_full_name", read_only=True, default=None)

    class Meta:
        model = StockMovement
        fields = ["id", "article", "article_code", "article_name", "depot", "depot_code", "kind", "kind_label",
                  "quantity", "unit_cost", "reference", "reason", "source_type", "source_id", "user_name",
                  "occurred_at", "client_timestamp"]
        read_only_fields = fields


class StockCardLineSerializer(serializers.Serializer):
    movement = StockMovementSerializer()
    balance = serializers.IntegerField()


class AdjustmentSerializer(serializers.Serializer):
    article = serializers.PrimaryKeyRelatedField(queryset=Article.objects.all())
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.filter(is_active=True))
    kind = serializers.ChoiceField(choices=[StockMovement.Kind.LOSS, StockMovement.Kind.ADJUSTMENT,
                                            StockMovement.Kind.OPENING])
    quantity = serializers.IntegerField()
    reason = serializers.CharField(max_length=255)

    def validate_quantity(self, value):
        if value == 0:
            raise serializers.ValidationError("La quantité ne peut pas être nulle.")
        return value


class StockTransferLineSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    article_code = serializers.CharField(source="article.code", read_only=True)
    article_name = serializers.CharField(source="article.name", read_only=True)

    class Meta:
        model = StockTransferLine
        fields = ["id", "article", "article_code", "article_name", "quantity"]

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("La quantité doit être positive.")
        return value


class StockTransferSerializer(serializers.ModelSerializer):
    lines = StockTransferLineSerializer(many=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    from_depot_name = serializers.CharField(source="from_depot.name", read_only=True)
    to_depot_name = serializers.CharField(source="to_depot.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)
    validated_by_name = serializers.CharField(source="validated_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = StockTransfer
        fields = ["id", "number", "from_depot", "from_depot_name", "to_depot", "to_depot_name", "status",
                  "status_label", "note", "lines", "created_by_name", "validated_by_name", "validated_at",
                  "created_at", "sync_version"]
        read_only_fields = ["number", "status", "validated_at", "created_at", "sync_version"]

    def validate(self, attrs):
        if self.instance is not None and self.instance.status != StockTransfer.Status.DRAFT:
            raise serializers.ValidationError("Un transfert validé ou annulé ne peut plus être modifié.")
        source = attrs.get("from_depot", getattr(self.instance, "from_depot", None))
        target = attrs.get("to_depot", getattr(self.instance, "to_depot", None))
        if source == target:
            raise serializers.ValidationError({"to_depot": "Choisissez un dépôt d'arrivée différent."})
        lines = attrs.get("lines")
        if lines is not None:
            if not lines:
                raise serializers.ValidationError({"lines": "Ajoutez au moins un article."})
            ids = [line["article"].pk for line in lines]
            if len(ids) != len(set(ids)):
                raise serializers.ValidationError({"lines": "Un article apparaît plusieurs fois."})
            for line in lines:
                article = line["article"]
                if article.type == Article.Type.SERVICE or (
                        article.type == Article.Type.KIT and article.kit.stock_mode == Kit.StockMode.VIRTUAL):
                    raise serializers.ValidationError({"lines": f"« {article.name} » n'a pas de stock propre."})
        return attrs

    def _replace_lines(self, transfer, lines):
        for line in transfer.lines.all():
            line.soft_delete()
        for line in lines:
            line.pop("id", None)
            StockTransferLine.objects.create(transfer=transfer, **line)

    def create(self, validated_data):
        from apps.core.numbering import next_document_number

        lines = validated_data.pop("lines")
        transfer = StockTransfer.objects.create(number=next_document_number("TR"), **validated_data)
        self._replace_lines(transfer, lines)
        return transfer

    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        for name, value in validated_data.items():
            setattr(instance, name, value)
        instance.save()
        if lines is not None:
            self._replace_lines(instance, lines)
        return instance


class KitAssemblySerializer(serializers.ModelSerializer):
    kit = serializers.PrimaryKeyRelatedField(queryset=Kit.objects.select_related("article"))
    kit_name = serializers.CharField(source="kit.article.name", read_only=True)
    kit_code = serializers.CharField(source="kit.article.code", read_only=True)
    depot_code = serializers.CharField(source="depot.code", read_only=True)
    operation_label = serializers.CharField(source="get_operation_display", read_only=True)
    user_name = serializers.CharField(source="user.get_full_name", read_only=True, default=None)

    class Meta:
        model = KitAssembly
        fields = ["id", "number", "kit", "kit_name", "kit_code", "depot", "depot_code", "operation",
                  "operation_label", "quantity", "note", "user_name", "created_at"]
        read_only_fields = ["number", "created_at"]


class StockAlertSerializer(serializers.ModelSerializer):
    article_code = serializers.CharField(source="article.code", read_only=True)
    article_name = serializers.CharField(source="article.name", read_only=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = StockAlert
        fields = ["id", "article", "article_code", "article_name", "kind", "kind_label", "available", "threshold",
                  "created_at", "resolved_at"]
