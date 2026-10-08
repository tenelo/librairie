from django.db import transaction
from rest_framework import serializers

from apps.catalog.models import Article
from apps.core.numbering import next_document_number
from apps.stock.models import Depot

from .models import GoodsReceipt, GoodsReceiptLine, PurchaseOrder, PurchaseOrderLine, Supplier


class SupplierSerializer(serializers.ModelSerializer):
    order_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Supplier
        fields = ["id", "name", "contact_name", "phone", "email", "address", "payment_terms", "lead_time_days",
                  "notes", "is_active", "order_count", "sync_version", "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]


class PurchaseOrderLineSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    article_code = serializers.CharField(source="article.code", read_only=True)
    article_name = serializers.CharField(source="article.name", read_only=True)
    remaining = serializers.IntegerField(read_only=True)
    amount = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrderLine
        fields = ["id", "article", "article_code", "article_name", "quantity", "unit_cost", "received_quantity",
                  "remaining", "amount"]
        read_only_fields = ["received_quantity"]

    def get_amount(self, obj) -> int:
        return obj.quantity * obj.unit_cost

    def validate(self, attrs):
        article = attrs["article"]
        if article.type == Article.Type.SERVICE:
            raise serializers.ValidationError({"article": "Un service ne se commande pas à un fournisseur."})
        if article.type == Article.Type.KIT and article.kit.stock_mode != "ASSEMBLED":
            raise serializers.ValidationError({"article": "Commandez les composants d'un kit virtuel."})
        if attrs["quantity"] <= 0:
            raise serializers.ValidationError({"quantity": "La quantité doit être positive."})
        return attrs


class PurchaseOrderSerializer(serializers.ModelSerializer):
    lines = PurchaseOrderLineSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    depot_code = serializers.CharField(source="depot.code", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    total = serializers.IntegerField(read_only=True)
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.filter(is_active=True))

    class Meta:
        model = PurchaseOrder
        fields = ["id", "number", "supplier", "supplier_name", "depot", "depot_code", "status", "status_label",
                  "order_date", "expected_date", "note", "lines", "total", "created_by_name", "sent_at",
                  "created_at", "sync_version"]
        read_only_fields = ["number", "status", "sent_at", "created_at", "sync_version"]

    def validate(self, attrs):
        if self.instance is not None and self.instance.status != PurchaseOrder.Status.DRAFT:
            raise serializers.ValidationError("Seul un bon de commande en brouillon est modifiable.")
        lines = attrs.get("lines")
        if lines is not None:
            if not lines:
                raise serializers.ValidationError({"lines": "Ajoutez au moins un article."})
            ids = [line["article"].pk for line in lines]
            if len(ids) != len(set(ids)):
                raise serializers.ValidationError({"lines": "Un article apparaît plusieurs fois."})
        expected, ordered = attrs.get("expected_date"), attrs.get("order_date")
        if expected and ordered and expected < ordered:
            raise serializers.ValidationError({"expected_date": "La livraison ne peut précéder la commande."})
        return attrs

    def _replace_lines(self, order, lines):
        for line in order.lines.all():
            line.soft_delete()
        for line in lines:
            line.pop("id", None)
            PurchaseOrderLine.objects.create(order=order, **line)

    @transaction.atomic
    def create(self, validated_data):
        lines = validated_data.pop("lines")
        order = PurchaseOrder.objects.create(number=next_document_number("BC"), **validated_data)
        self._replace_lines(order, lines)
        return order

    @transaction.atomic
    def update(self, instance, validated_data):
        lines = validated_data.pop("lines", None)
        for name, value in validated_data.items():
            setattr(instance, name, value)
        instance.save()
        if lines is not None:
            self._replace_lines(instance, lines)
        return instance


class GoodsReceiptLineSerializer(serializers.ModelSerializer):
    article_code = serializers.CharField(source="article.code", read_only=True)
    article_name = serializers.CharField(source="article.name", read_only=True)
    order_line = serializers.PrimaryKeyRelatedField(queryset=PurchaseOrderLine.objects.all(), required=False,
                                                    allow_null=True)

    class Meta:
        model = GoodsReceiptLine
        fields = ["id", "article", "article_code", "article_name", "order_line", "quantity", "unit_cost"]
        read_only_fields = ["id"]

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("La quantité reçue doit être positive.")
        return value


class GoodsReceiptSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    lines = GoodsReceiptLineSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    depot_code = serializers.CharField(source="depot.code", read_only=True)
    purchase_order_number = serializers.CharField(source="purchase_order.number", read_only=True, default=None)
    user_name = serializers.CharField(source="user.get_full_name", read_only=True, default=None)
    total = serializers.IntegerField(read_only=True)
    received_at = serializers.DateTimeField(required=False)
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.filter(is_active=True))

    class Meta:
        model = GoodsReceipt
        fields = ["id", "number", "supplier", "supplier_name", "depot", "depot_code", "purchase_order",
                  "purchase_order_number", "received_at", "delivery_note", "note", "lines", "total", "user_name",
                  "created_at"]
        read_only_fields = ["number", "created_at"]


class SuggestionSerializer(serializers.Serializer):
    article = serializers.UUIDField(source="article.pk")
    article_code = serializers.CharField(source="article.code")
    article_name = serializers.CharField(source="article.name")
    available = serializers.IntegerField()
    on_order = serializers.IntegerField()
    daily_sales = serializers.FloatField()
    reorder_point = serializers.IntegerField()
    alert_threshold = serializers.IntegerField(source="article.alert_threshold")
    max_stock = serializers.IntegerField(source="article.max_stock", allow_null=True)
    suggested_quantity = serializers.IntegerField()
    supplier = serializers.UUIDField(source="supplier.pk", allow_null=True, default=None)
    supplier_name = serializers.CharField(source="supplier.name", allow_null=True, default=None)
    unit_cost = serializers.IntegerField()


class SuggestionOrderItemSerializer(serializers.Serializer):
    article = serializers.PrimaryKeyRelatedField(queryset=Article.objects.all())
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.filter(is_active=True))
    quantity = serializers.IntegerField(min_value=1)
    unit_cost = serializers.IntegerField(min_value=0)


class SuggestionOrderSerializer(serializers.Serializer):
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.filter(is_active=True))
    items = SuggestionOrderItemSerializer(many=True)
