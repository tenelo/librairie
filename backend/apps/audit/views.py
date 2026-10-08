import django_filters
from rest_framework import viewsets

from apps.core.permissions import HasAppPermission

from .models import AuditLog
from .serializers import AuditLogSerializer

CONNECTION_ACTIONS = [
    AuditLog.Action.LOGIN,
    AuditLog.Action.LOGIN_FAILED,
    AuditLog.Action.LOGOUT,
    AuditLog.Action.PIN_UNLOCK,
    AuditLog.Action.PIN_FAILED,
]


class AuditLogFilter(django_filters.FilterSet):
    date_from = django_filters.IsoDateTimeFilter(field_name="server_timestamp", lookup_expr="gte")
    date_to = django_filters.IsoDateTimeFilter(field_name="server_timestamp", lookup_expr="lte")
    action = django_filters.MultipleChoiceFilter(choices=AuditLog.Action.choices)
    connections = django_filters.BooleanFilter(method="filter_connections")

    class Meta:
        model = AuditLog
        fields = ["user", "device", "entity", "entity_id", "origin", "action"]

    def filter_connections(self, queryset, name, value):
        if value:
            return queryset.filter(action__in=CONNECTION_ACTIONS)
        return queryset.exclude(action__in=CONNECTION_ACTIONS)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Consultation du journal (lecture seule : aucune écriture possible depuis l'API)."""

    queryset = AuditLog.objects.select_related("device").all()
    serializer_class = AuditLogSerializer
    permission_classes = [HasAppPermission]
    required_permissions = "audit.view"
    filterset_class = AuditLogFilter
    search_fields = ["username", "entity", "entity_id", "description"]
    ordering_fields = ["server_timestamp", "action", "username"]
