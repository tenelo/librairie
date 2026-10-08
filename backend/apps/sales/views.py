"""API de consultation des ventes, caisses, retours, avoirs et bons d'achat.

Les écritures (vente, retour, ouverture/clôture, mouvements d'espèces) passent par `sync/push`
pour être identiques en ligne et hors ligne ; seuls les référentiels se gèrent ici.
"""
import secrets

import django_filters
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.core.permissions import HasAppPermission, IsStaffMember

from . import services
from .models import CashSession, CreditNote, Payment, PaymentMethod, Sale, SaleLine, SaleReturn, Voucher


class PaymentMethodSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = PaymentMethod
        fields = ["id", "code", "label", "kind", "kind_label", "requires_reference", "is_active", "sort_order"]


class PaymentMethodViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = PaymentMethod.objects.all()
    serializer_class = PaymentMethodSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "settings.manage"}
    pagination_class = None
    audit_entity = "PaymentMethod"


class SaleLineSerializer(serializers.ModelSerializer):
    article_code = serializers.CharField(source="article.code", read_only=True)
    returnable = serializers.SerializerMethodField()

    class Meta:
        model = SaleLine
        fields = ["id", "article", "article_code", "description", "quantity", "unit_price", "price_kind", "discount",
                  "line_total", "kit_adjustments", "returnable"]

    def get_returnable(self, obj) -> int:
        return services.returnable_quantity(obj)


class PaymentSerializer(serializers.ModelSerializer):
    method_code = serializers.CharField(source="method.code", read_only=True)
    method_label = serializers.CharField(source="method.label", read_only=True)

    class Meta:
        model = Payment
        fields = ["id", "method_code", "method_label", "amount", "reference"]


class SaleSerializer(serializers.ModelSerializer):
    lines = SaleLineSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    cashier_name = serializers.CharField(source="cashier.get_full_name", read_only=True)
    device_code = serializers.CharField(source="device.code", read_only=True, default=None)
    customer_name = serializers.CharField(source="customer.name", read_only=True, default=None)
    depot_code = serializers.CharField(source="depot.code", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Sale
        fields = ["id", "receipt_number", "status", "status_label", "channel", "customer", "customer_name",
                  "cashier_name", "device_code", "depot_code", "cash_session", "sold_at", "subtotal",
                  "discount_total", "total", "paid_total", "change_due", "reprint_count", "loyalty_points", "notes",
                  "lines", "payments"]


class SaleFilter(django_filters.FilterSet):
    date_from = django_filters.IsoDateTimeFilter(field_name="sold_at", lookup_expr="gte")
    date_to = django_filters.IsoDateTimeFilter(field_name="sold_at", lookup_expr="lte")

    class Meta:
        model = Sale
        fields = ["cashier", "device", "customer", "cash_session", "channel", "status", "depot"]


class SaleViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SaleSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"*": "sales.view", "by_number": ["sales.view"]}
    filterset_class = SaleFilter
    search_fields = ["receipt_number", "customer__name", "customer__phone"]
    ordering_fields = ["sold_at", "total"]

    def get_queryset(self):
        return Sale.objects.select_related("cashier", "device", "customer", "depot").prefetch_related(
            "lines__article", "lines__return_lines", "payments__method")

    @extend_schema(parameters=[OpenApiParameter("number", str, required=True)], responses=SaleSerializer)
    @action(detail=False, methods=["get"], url_path="by-number")
    def by_number(self, request):
        """Vente retrouvée par son numéro de reçu (saisie ou scan du QR code du reçu)."""
        sale = self.get_queryset().filter(receipt_number=(request.query_params.get("number") or "").strip()).first()
        if sale is None:
            return Response({"detail": "Aucune vente avec ce numéro de reçu."}, status=404)
        return Response(self.get_serializer(sale).data)


class CashSessionSerializer(serializers.ModelSerializer):
    device_code = serializers.CharField(source="device.code", read_only=True, default=None)
    depot_code = serializers.CharField(source="depot.code", read_only=True)
    opened_by_name = serializers.CharField(source="opened_by.get_full_name", read_only=True)
    closed_by_name = serializers.CharField(source="closed_by.get_full_name", read_only=True, default=None)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = CashSession
        fields = ["id", "device", "device_code", "depot", "depot_code", "status", "status_label", "opened_by_name",
                  "opened_at", "opening_float", "closed_by_name", "closed_at", "counted_cash", "expected_cash",
                  "variance", "z_number", "notes"]


class CashSessionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CashSession.objects.select_related("device", "depot", "opened_by", "closed_by")
    serializer_class = CashSessionSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"*": "cash.z_report", "list": "cash.open_close", "retrieve": "cash.open_close",
                            "z_report": "cash.open_close"}
    filterset_fields = ["device", "status", "depot"]

    @extend_schema(responses=serializers.DictField())
    @action(detail=True, methods=["get"], url_path="z-report")
    def z_report(self, request, pk=None):
        return Response(services.z_report(self.get_object()))


class SaleReturnSerializer(serializers.ModelSerializer):
    receipt_number = serializers.CharField(source="sale.receipt_number", read_only=True)
    user_name = serializers.CharField(source="user.get_full_name", read_only=True)
    authorized_by_name = serializers.CharField(source="authorized_by.get_full_name", read_only=True)
    refund_mode_label = serializers.CharField(source="get_refund_mode_display", read_only=True)
    credit_note_number = serializers.CharField(source="credit_note.number", read_only=True, default=None)

    class Meta:
        model = SaleReturn
        fields = ["id", "number", "sale", "receipt_number", "refund_mode", "refund_mode_label", "total", "reason",
                  "user_name", "authorized_by_name", "credit_note_number", "returned_at"]


class SaleReturnViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SaleReturn.objects.select_related("sale", "user", "authorized_by", "credit_note")
    serializer_class = SaleReturnSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "sales.view"
    search_fields = ["number", "sale__receipt_number"]


class CreditNoteSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True, default=None)

    class Meta:
        model = CreditNote
        fields = ["id", "number", "customer", "customer_name", "amount", "remaining", "expires_at", "created_at"]


class CreditNoteViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CreditNote.objects.select_related("customer")
    serializer_class = CreditNoteSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "customers.view"
    filterset_fields = ["customer"]
    search_fields = ["number", "customer__name"]


class VoucherSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True, default=None)

    class Meta:
        model = Voucher
        fields = ["id", "code", "customer", "customer_name", "amount", "remaining", "expires_at", "is_active",
                  "created_at"]
        read_only_fields = ["code", "remaining", "created_at"]


class VoucherViewSet(AuditedViewSetMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin,
                     viewsets.ReadOnlyModelViewSet):
    queryset = Voucher.objects.select_related("customer")
    serializer_class = VoucherSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "customers.view", "write": "customers.manage"}
    search_fields = ["code", "customer__name"]
    audit_entity = "Voucher"

    def perform_create(self, serializer):
        code = f"BA-{timezone.localdate():%y%m}-{secrets.token_hex(3).upper()}"
        serializer.validated_data["code"] = code
        serializer.validated_data["remaining"] = serializer.validated_data["amount"]
        super().perform_create(serializer)
