from rest_framework import serializers

from apps.catalog.models import Article, Kit
from apps.stock.models import Depot

from .models import OnlineOrder, OnlineOrderLine, OrderStatusHistory, PaymentTransaction


class OrderLineSerializer(serializers.ModelSerializer):
    code = serializers.CharField(source="article.code", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = OnlineOrderLine
        fields = ["id", "article", "code", "description", "ordered_qty", "quantity", "unit_price", "line_total",
                  "prepared_qty", "status", "status_label", "proposal", "original_article"]


class OrderHistorySerializer(serializers.ModelSerializer):
    to_label = serializers.SerializerMethodField()
    user_name = serializers.CharField(source="user.get_full_name", read_only=True, default=None)

    class Meta:
        model = OrderStatusHistory
        fields = ["from_status", "to_status", "to_label", "note", "user_name", "at"]

    def get_to_label(self, obj) -> str:
        return OnlineOrder.Status(obj.to_status).label


class PaymentTransactionSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PaymentTransaction
        fields = ["id", "provider", "operator", "phone", "amount", "status", "status_label", "external_ref",
                  "message", "created_at", "completed_at"]


class OnlineOrderSerializer(serializers.ModelSerializer):
    """Commande vue par la librairie."""

    status_label = serializers.CharField(source="get_status_display", read_only=True)
    payment_mode_label = serializers.CharField(source="get_payment_mode_display", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    pickup_depot_name = serializers.CharField(source="pickup_depot.name", read_only=True)
    preparer_name = serializers.CharField(source="preparer.get_full_name", read_only=True, default=None)
    sale_receipt = serializers.CharField(source="sale.receipt_number", read_only=True, default=None)
    lines = OrderLineSerializer(many=True, read_only=True)
    history = OrderHistorySerializer(many=True, read_only=True)
    payments = PaymentTransactionSerializer(many=True, read_only=True)
    balance_due = serializers.IntegerField(read_only=True)
    qr_payload = serializers.CharField(read_only=True)

    class Meta:
        model = OnlineOrder
        fields = ["id", "number", "status", "status_label", "customer", "customer_name", "customer_phone",
                  "pickup_depot", "pickup_depot_name", "pickup_slot", "comment", "pickup_code", "qr_payload",
                  "accept_partial", "awaiting_customer", "payment_mode", "payment_mode_label", "total",
                  "deposit_due", "deposit_paid", "balance_due", "parcels", "preparer", "preparer_name",
                  "sale", "sale_receipt", "confirmed_at", "ready_at", "expires_at", "picked_up_at", "cancelled_at",
                  "cancel_reason", "created_at", "lines", "history", "payments"]


class ShopOrderSerializer(OnlineOrderSerializer):
    """Commande vue par le client (sans données internes)."""

    class Meta(OnlineOrderSerializer.Meta):
        fields = ["id", "number", "status", "status_label", "pickup_depot", "pickup_depot_name", "pickup_slot",
                  "comment", "pickup_code", "qr_payload", "accept_partial", "awaiting_customer", "payment_mode",
                  "payment_mode_label", "total", "deposit_due", "deposit_paid", "balance_due", "sale_receipt",
                  "confirmed_at", "ready_at", "expires_at", "picked_up_at", "cancelled_at", "cancel_reason",
                  "created_at", "lines", "history", "payments"]


class PlaceOrderLineSerializer(serializers.Serializer):
    article = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=999)


class PlaceOrderSerializer(serializers.Serializer):
    pickup_depot = serializers.UUIDField(required=False, allow_null=True)
    pickup_slot = serializers.DateTimeField(required=False, allow_null=True)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    accept_partial = serializers.BooleanField(default=False)
    payment_mode = serializers.ChoiceField(choices=OnlineOrder.PaymentMode.choices, default="ON_PICKUP")
    lines = PlaceOrderLineSerializer(many=True)


class PrepareLineSerializer(serializers.Serializer):
    line = serializers.UUIDField()
    prepared_qty = serializers.IntegerField(min_value=0)


class ShortageSerializer(serializers.Serializer):
    line = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=0)
    substitute = serializers.UUIDField(required=False, allow_null=True)


class PrepareSerializer(serializers.Serializer):
    lines = PrepareLineSerializer(many=True, required=False)
    shortages = ShortageSerializer(many=True, required=False)
    ready = serializers.BooleanField(default=False)
    parcels = serializers.IntegerField(required=False, min_value=1, max_value=99)


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=255)


class DepositSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    operator = serializers.CharField(max_length=20)


# --- Catalogue public de la boutique -----------------------------------------------------------


class ShopArticleSerializer(serializers.ModelSerializer):
    category_path = serializers.CharField(source="category.path", read_only=True, default=None)
    brand_name = serializers.CharField(source="brand.name", read_only=True, default=None)
    price = serializers.IntegerField(source="retail_price", read_only=True)
    image = serializers.SerializerMethodField()
    availability = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = ["id", "code", "name", "description", "type", "category", "category_path", "brand_name", "price",
                  "image", "availability", "available"]

    def get_image(self, obj) -> str | None:
        images = [i for i in obj.images.all() if not i.is_deleted]
        if not images:
            return None
        request = self.context.get("request")
        url = images[0].image.url
        return request.build_absolute_uri(url) if request else url

    def get_availability(self, obj) -> str:
        return self.context["availability"](obj)[0]

    def get_available(self, obj) -> int | None:
        """Quantité commandable (plafonnée : on n'expose pas le stock exact au-delà de 20)."""
        available = self.context["availability"](obj)[1]
        return None if available is None else min(max(available, 0), 20)


class ShopKitSerializer(serializers.ModelSerializer):
    article = ShopArticleSerializer(read_only=True)
    level_label = serializers.CharField(source="level.label", read_only=True)
    school_name = serializers.CharField(source="school.name", read_only=True, default=None)
    school_year_label = serializers.CharField(source="school_year.label", read_only=True, default=None)
    components = serializers.SerializerMethodField()

    class Meta:
        model = Kit
        fields = ["id", "article", "level", "level_label", "school", "school_name", "school_year_label",
                  "components"]

    def get_components(self, obj) -> list:
        return [{"name": c.article.name, "quantity": c.quantity, "is_optional": c.is_optional}
                for c in obj.components.all() if not c.is_deleted]


class PickupPointSerializer(serializers.ModelSerializer):
    class Meta:
        model = Depot
        fields = ["id", "code", "name", "address"]
