from django.db.models import Count, Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.mixins import AuditedViewSetMixin
from apps.core.permissions import HasAppPermission, IsStaffMember

from .models import Customer, School
from .serializers import CustomerSerializer, SchoolSerializer


class SchoolViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    """Établissements scolaires : lecture par le personnel, gestion avec `catalog.manage` (listes de fournitures)."""

    serializer_class = SchoolSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "catalog.manage"}
    filterset_fields = ["city", "is_active"]
    search_fields = ["name", "city", "district"]
    ordering_fields = ["name", "city"]
    audit_entity = "School"

    def get_queryset(self):
        return (
            School.objects.annotate(kit_count=Count("kits", filter=Q(kits__is_deleted=False)))
            .order_by("name")
        )


class CustomerViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    """Clients : consultation par la caisse, gestion avec `customers.manage` (suppression logique)."""

    serializer_class = CustomerSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "customers.view", "write": "customers.manage", "statement": "customers.view"}
    filterset_fields = ["school", "is_active"]
    search_fields = ["name", "phone", "email"]
    ordering_fields = ["name", "created_at"]
    audit_entity = "Customer"

    def get_queryset(self):
        return Customer.objects.select_related("school").order_by("name")

    @action(detail=True, methods=["get"])
    def statement(self, request, pk=None):
        """Relevé : écritures de crédit, points de fidélité, avoirs et dernières ventes."""
        customer = self.get_object()
        entries = [{"date": e.created_at, "kind": e.get_kind_display(), "amount": e.amount,
                    "reference": e.sale.receipt_number if e.sale_id else e.reference}
                   for e in customer.account_entries.select_related("sale")[:200]]
        loyalty = [{"date": e.created_at, "points": e.points, "reason": e.reason}
                   for e in customer.loyalty_entries.all()[:200]]
        credit_notes = [{"number": c.number, "amount": c.amount, "remaining": c.remaining}
                        for c in customer.credit_notes.all()]
        sales = [{"id": str(s.pk), "receipt_number": s.receipt_number, "sold_at": s.sold_at, "total": s.total}
                 for s in customer.sales.order_by("-sold_at")[:50]]
        return Response({"account": entries, "loyalty": loyalty, "credit_notes": credit_notes, "sales": sales})
