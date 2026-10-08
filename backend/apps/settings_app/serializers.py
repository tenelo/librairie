from django.conf import settings
from rest_framework import serializers

from .models import LibrarySettings


class LibrarySettingsSerializer(serializers.ModelSerializer):
    currency = serializers.SerializerMethodField()

    class Meta:
        model = LibrarySettings
        fields = [
            "id",
            "name",
            "logo",
            "address",
            "city",
            "phone",
            "email",
            "website",
            "taxpayer_number",
            "trade_register",
            "receipt_header",
            "receipt_footer",
            "vat_enabled",
            "default_vat_rate",
            "offline_max_hours",
            "order_expiry_hours",
            "sync_interval_minutes",
            "loyalty_points_per_1000",
            "loyalty_point_value",
            "price_rounding",
            "currency",
            "sync_version",
            "updated_at",
        ]
        read_only_fields = ["id", "currency", "sync_version", "updated_at"]

    def get_currency(self, obj) -> dict:
        return {"code": settings.CURRENCY_CODE, "label": settings.CURRENCY_LABEL, "decimals": 0}


class PublicLibrarySettingsSerializer(serializers.ModelSerializer):
    """Sous-ensemble public utilisé par la boutique (sans authentification)."""

    class Meta:
        model = LibrarySettings
        fields = ["name", "logo", "address", "city", "phone", "email", "website", "order_expiry_hours"]
        read_only_fields = fields
