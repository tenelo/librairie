from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.pdf import PdfUnavailable
from apps.core.permissions import HasAppPermission, IsStaffMember
from apps.stock.models import Depot

from . import exports, scheduling, services
from .models import ScheduledReport

PERIOD_PARAMS = [
    OpenApiParameter("date_from", OpenApiTypes.DATE), OpenApiParameter("date_to", OpenApiTypes.DATE),
    OpenApiParameter("depot", OpenApiTypes.UUID),
    OpenApiParameter("export", str, enum=["xlsx", "pdf"], description="Télécharger le rapport"),
]


class DashboardView(APIView):
    """Indicateurs du tableau de bord (aujourd'hui, semaine, mois) avec comparaison à la période précédente."""

    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "dashboard.view"

    @extend_schema(parameters=[OpenApiParameter("scope", str, enum=["today", "week", "month"]),
                               OpenApiParameter("depot", OpenApiTypes.UUID)], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        depot = Depot.objects.filter(pk=request.query_params.get("depot")).first() \
            if request.query_params.get("depot") else None
        data = services.dashboard(request.query_params.get("scope", "today"), depot)
        if not request.user.has_app_perm("stats.view"):
            # Sans accès aux statistiques : pas de marge ni de détail par article.
            data["kpis"] = [k for k in data["kpis"] if k["key"] != "margin"]
            data["top"] = None
        return Response(data)


class ReportView(APIView):
    """Rapports statistiques : sales, kits, stock, orders, cash, inventories (JSON, Excel ou PDF)."""

    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "stats.view"

    @extend_schema(parameters=PERIOD_PARAMS, responses=OpenApiTypes.OBJECT)
    def get(self, request, name):
        if name not in services.REPORTS:
            raise NotFound("Rapport inconnu.")
        data = services.build(name, request.query_params)
        export = request.query_params.get("export")
        if export == "xlsx":
            response = HttpResponse(exports.to_xlsx(data), content_type=exports.XLSX)
            response["Content-Disposition"] = f'attachment; filename="{exports.filename(data, "xlsx")}"'
            return response
        if export == "pdf":
            try:
                content = exports.to_pdf(data)
            except PdfUnavailable as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            response = HttpResponse(content, content_type="application/pdf")
            response["Content-Disposition"] = f'attachment; filename="{exports.filename(data, "pdf")}"'
            return response
        return Response(data)


class ScheduledReportSerializer(serializers.ModelSerializer):
    report_label = serializers.SerializerMethodField()
    frequency_label = serializers.CharField(source="get_frequency_display", read_only=True)
    recipients = serializers.ListField(child=serializers.EmailField(), min_length=1)

    class Meta:
        model = ScheduledReport
        fields = ["id", "name", "report", "report_label", "frequency", "frequency_label", "recipients", "filters",
                  "send_hour", "is_active", "last_sent_at", "last_error", "created_at"]
        read_only_fields = ["last_sent_at", "last_error", "created_at"]

    def get_report_label(self, obj) -> str:
        return services.REPORTS.get(obj.report, (obj.report,))[0]

    def validate_report(self, value):
        if value not in services.REPORTS:
            raise serializers.ValidationError("Rapport inconnu.")
        return value

    def validate_send_hour(self, value):
        if value > 23:
            raise serializers.ValidationError("Heure invalide (0 à 23).")
        return value


class ScheduledReportViewSet(viewsets.ModelViewSet):
    serializer_class = ScheduledReportSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "stats.view"
    queryset = ScheduledReport.objects.all()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        """Envoi immédiat (test) du rapport planifié."""
        scheduling.send(self.get_object())
        return Response({"sent": True})
