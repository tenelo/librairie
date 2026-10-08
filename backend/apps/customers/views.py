from django.db.models import Count, Q
from rest_framework import viewsets

from apps.audit.mixins import AuditedViewSetMixin
from apps.core.permissions import HasAppPermission, IsStaffMember

from .models import School
from .serializers import SchoolSerializer


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
