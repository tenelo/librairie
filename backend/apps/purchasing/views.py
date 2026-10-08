from django.db.models import Count
from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.core.pdf import PdfUnavailable, render_html, render_pdf
from apps.core.permissions import HasAppPermission, IsStaffMember
from apps.core.request_context import get_client_timestamp, get_request_device
from apps.settings_app.models import LibrarySettings

from . import services
from .models import GoodsReceipt, PurchaseOrder, Supplier
from .serializers import (
    GoodsReceiptSerializer,
    PurchaseOrderSerializer,
    SuggestionOrderSerializer,
    SuggestionSerializer,
    SupplierSerializer,
)

PURCHASING_PERMISSIONS = {"read": "purchasing.view", "write": "purchasing.manage"}


class SupplierViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = SupplierSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "purchasing.manage"}
    filterset_fields = ["is_active"]
    search_fields = ["name", "contact_name", "phone", "email"]
    ordering_fields = ["name"]
    audit_entity = "Supplier"

    def get_queryset(self):
        return Supplier.objects.annotate(order_count=Count("orders")).order_by("name")

    def destroy(self, request, *args, **kwargs):
        supplier = self.get_object()
        if supplier.orders.exists() or supplier.receipts.exists():
            return Response({"detail": "Ce fournisseur a un historique d'achats : désactivez-le plutôt."},
                            status=400)
        return super().destroy(request, *args, **kwargs)


def order_document_context(order):
    lines = [{"article": line.article, "quantity": line.quantity, "unit_cost": line.unit_cost,
              "amount": line.quantity * line.unit_cost} for line in order.lines.select_related("article")]
    return {"order": order, "lines": lines, "total": sum(line["amount"] for line in lines),
            "library": LibrarySettings.load()}


class PurchaseOrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                           mixins.UpdateModelMixin, viewsets.GenericViewSet):
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {**PURCHASING_PERMISSIONS, "pdf": "purchasing.view", "document": "purchasing.view"}
    filterset_fields = ["status", "supplier", "depot"]
    search_fields = ["number", "supplier__name", "note"]
    ordering_fields = ["order_date", "number", "expected_date"]

    def get_queryset(self):
        queryset = PurchaseOrder.objects.select_related("supplier", "depot", "created_by").prefetch_related(
            "lines__article")
        if self.request.query_params.get("open") in ("1", "true"):
            queryset = queryset.filter(status__in=PurchaseOrder.OPEN_STATUSES)
        return queryset

    def perform_create(self, serializer):
        order = serializer.save(created_by=self.request.user)
        log_event(AuditLog.Action.CREATE, request=self.request, entity="PurchaseOrder", entity_id=order.pk,
                  description=f"Bon de commande {order.number} ({order.supplier.name})")

    def _transition(self, request, func, label):
        order = func(self.get_object())
        log_event(AuditLog.Action.UPDATE, request=request, entity="PurchaseOrder", entity_id=order.pk,
                  description=f"{label} du bon de commande {order.number}")
        return Response(self.get_serializer(self.get_queryset().get(pk=order.pk)).data)

    @extend_schema(request=None, responses=PurchaseOrderSerializer)
    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        return self._transition(request, services.send_order, "Envoi")

    @extend_schema(request=None, responses=PurchaseOrderSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._transition(request, services.cancel_order, "Annulation")

    @extend_schema(request=None, responses=PurchaseOrderSerializer)
    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        return self._transition(request, services.close_order, "Solde")

    @extend_schema(responses={(200, "application/pdf"): bytes})
    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        order = self.get_object()
        try:
            content = render_pdf("purchasing/purchase_order.html", order_document_context(order),
                                 base_url=request.build_absolute_uri("/"))
        except PdfUnavailable as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        response = HttpResponse(content, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{order.number}.pdf"'
        return response

    @extend_schema(responses={(200, "text/html"): str})
    @action(detail=True, methods=["get"])
    def document(self, request, pk=None):
        """Version HTML imprimable du bon (même gabarit que le PDF)."""
        return HttpResponse(render_html("purchasing/purchase_order.html", order_document_context(self.get_object())))


class GoodsReceiptViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                          viewsets.GenericViewSet):
    """Réceptions : enregistrées et validées en une fois (entrée en stock, CMP, reliquats du bon)."""

    serializer_class = GoodsReceiptSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "purchasing.view", "write": "purchasing.receive"}
    filterset_fields = ["supplier", "depot", "purchase_order"]
    search_fields = ["number", "supplier__name", "delivery_note"]

    def get_queryset(self):
        return GoodsReceipt.objects.select_related("supplier", "depot", "purchase_order", "user").prefetch_related(
            "lines__article")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        receipt = services.receive_goods(
            supplier=data["supplier"], depot=data["depot"], lines=data["lines"], user=request.user,
            purchase_order=data.get("purchase_order"), received_at=data.get("received_at"),
            delivery_note=data.get("delivery_note", ""), note=data.get("note", ""), receipt_id=data.get("id"),
            device=get_request_device(request), client_timestamp=get_client_timestamp(request),
        )
        log_event(AuditLog.Action.CREATE, request=request, entity="GoodsReceipt", entity_id=receipt.pk,
                  description=f"Réception {receipt.number} ({receipt.supplier.name}, {receipt.lines.count()} ligne(s))")
        return Response(self.get_serializer(self.get_queryset().get(pk=receipt.pk)).data,
                        status=status.HTTP_201_CREATED)


class SuggestionViewSet(viewsets.ViewSet):
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"list": "purchasing.view", "create_orders": "purchasing.manage"}

    @extend_schema(parameters=[OpenApiParameter("supplier", str), OpenApiParameter("days", int),
                               OpenApiParameter("coverage_days", int)],
                   responses=SuggestionSerializer(many=True))
    def list(self, request):
        supplier = Supplier.objects.filter(pk=request.query_params.get("supplier")).first() if \
            request.query_params.get("supplier") else None
        days = min(max(int(request.query_params.get("days", 90) or 90), 7), 365)
        coverage = min(max(int(request.query_params.get("coverage_days", 30) or 30), 7), 180)
        suggestions = services.reorder_suggestions(days=days, coverage_days=coverage, supplier=supplier)
        return Response(SuggestionSerializer(suggestions, many=True).data)

    @extend_schema(request=SuggestionOrderSerializer, responses={201: PurchaseOrderSerializer(many=True)})
    @action(detail=False, methods=["post"], url_path="create-orders")
    def create_orders(self, request):
        data = SuggestionOrderSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        orders = services.create_orders_from_suggestions(data.validated_data["items"], data.validated_data["depot"],
                                                         user=request.user)
        for order in orders:
            log_event(AuditLog.Action.CREATE, request=request, entity="PurchaseOrder", entity_id=order.pk,
                      description=f"Bon de commande {order.number} créé depuis les suggestions")
        return Response(PurchaseOrderSerializer(orders, many=True).data, status=201)
