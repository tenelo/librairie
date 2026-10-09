from io import BytesIO

import django_filters
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from openpyxl import Workbook
from openpyxl.styles import Font
from rest_framework import viewsets
from rest_framework.decorators import action

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

    @extend_schema(responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): bytes})
    @action(detail=False, methods=["get"])
    def export(self, request):
        """Export Excel des entrées filtrées (10 000 au plus)."""
        rows = self.filter_queryset(self.get_queryset())[:10000]
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Journal d'audit"
        headers = ["Date serveur", "Date client", "Action", "Entité", "Identifiant", "Description", "Utilisateur",
                   "Rôle", "Terminal", "Adresse IP", "Origine", "Anciennes valeurs", "Nouvelles valeurs"]
        sheet.append(headers)
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for log in rows:
            sheet.append([
                timezone.localtime(log.server_timestamp).replace(tzinfo=None),
                timezone.localtime(log.client_timestamp).replace(tzinfo=None) if log.client_timestamp else None,
                log.get_action_display(), log.entity, log.entity_id, log.description, log.username, log.role_code,
                log.device.code if log.device_id else "", log.ip_address or "", log.get_origin_display(),
                str(log.old_values or ""), str(log.new_values or ""),
            ])
        sheet.column_dimensions["F"].width = 60
        buffer = BytesIO()
        workbook.save(buffer)
        response = HttpResponse(buffer.getvalue(),
                                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        response["Content-Disposition"] = f'attachment; filename="journal-audit-{timezone.localdate()}.xlsx"'
        return response
