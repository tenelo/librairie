from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.models import current_sync_version
from apps.core.permissions import HasAppPermission, IsStaffMember
from apps.core.request_context import get_request_device

from . import services
from .models import SyncConflict, SyncOperation


class OperationSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    entity = serializers.CharField(max_length=40)
    operation = serializers.CharField(max_length=20)
    payload = serializers.JSONField()
    client_timestamp = serializers.DateTimeField(required=False, allow_null=True)


class PushSerializer(serializers.Serializer):
    operations = OperationSerializer(many=True)

    def validate_operations(self, value):
        if len(value) > 200:
            raise serializers.ValidationError("200 opérations maximum par envoi.")
        return value


class PushView(APIView):
    """Reçoit un lot d'opérations de l'outbox d'un terminal. Chaque opération est traitée
    indépendamment (une erreur n'empêche pas les suivantes) et de façon idempotente."""

    permission_classes = [IsStaffMember]

    @extend_schema(request=PushSerializer, responses=inline_serializer("PushResult", {
        "results": serializers.ListField(child=serializers.DictField()), "server_time": serializers.DateTimeField(),
    }))
    def post(self, request):
        data = PushSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        operations = [{**op, "id": op["id"]} for op in data.validated_data["operations"]]
        results = services.push(operations, user=request.user, device=get_request_device(request), request=request)
        return Response({"results": results, "server_time": timezone.now()})


class PullView(APIView):
    permission_classes = [IsStaffMember]

    @extend_schema(parameters=[OpenApiParameter("since", int), OpenApiParameter("limit", int),
                               OpenApiParameter("entities", str, description="Liste séparée par des virgules")],
                   responses=inline_serializer("PullResult", {
                       "cursor": serializers.IntegerField(), "has_more": serializers.BooleanField(),
                       "changes": serializers.DictField(), "server_time": serializers.DateTimeField()}))
    def get(self, request):
        try:
            since = int(request.query_params.get("since", 0) or 0)
            limit = int(request.query_params.get("limit", 500) or 500)
        except ValueError:
            return Response({"detail": "Paramètres since / limit invalides."}, status=400)
        entities = [e for e in (request.query_params.get("entities") or "").split(",") if e] or None
        return Response(services.pull(request.user, since, limit, entities))


class SyncStateView(APIView):
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "sync.view"

    @extend_schema(responses=inline_serializer("SyncState", {
        "server_version": serializers.IntegerField(), "errors_24h": serializers.IntegerField(),
        "open_conflicts": serializers.IntegerField()}))
    def get(self, request):
        since = timezone.now() - timezone.timedelta(hours=24)
        return Response({
            "server_version": current_sync_version(),
            "errors_24h": SyncOperation.objects.filter(status="error", received_at__gte=since).count(),
            "open_conflicts": SyncConflict.objects.filter(reviewed_at__isnull=True).count(),
        })


class SyncOperationSerializer(serializers.ModelSerializer):
    device_code = serializers.CharField(source="device.code", default=None)
    username = serializers.CharField(source="user.username", default=None)

    class Meta:
        model = SyncOperation
        fields = ["id", "entity", "operation", "payload", "client_timestamp", "received_at", "status", "error",
                  "device_code", "username"]


class SyncOperationViewSet(viewsets.ReadOnlyModelViewSet):
    """Opérations reçues (journal serveur), filtrables par statut et terminal."""

    queryset = SyncOperation.objects.select_related("device", "user")
    serializer_class = SyncOperationSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "sync.view"
    filterset_fields = ["status", "entity", "device"]


class SyncConflictSerializer(serializers.ModelSerializer):
    resolution_label = serializers.CharField(source="get_resolution_display", read_only=True)
    device_code = serializers.CharField(source="operation.device.code", default=None)
    username = serializers.CharField(source="operation.user.username", default=None)

    class Meta:
        model = SyncConflict
        fields = ["id", "entity", "entity_id", "client_payload", "server_payload", "resolution", "resolution_label",
                  "created_at", "reviewed_at", "device_code", "username"]


class SyncConflictViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = SyncConflictSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"list": "sync.view", "*": "sync.manage"}

    def get_queryset(self):
        queryset = SyncConflict.objects.select_related("operation__device", "operation__user")
        if self.request.query_params.get("all") not in ("1", "true"):
            queryset = queryset.filter(reviewed_at__isnull=True)
        return queryset

    @extend_schema(request=None, responses=SyncConflictSerializer)
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        conflict = self.get_object()
        conflict.reviewed_at = timezone.now()
        conflict.reviewed_by = request.user
        conflict.save(update_fields=["reviewed_at", "reviewed_by"])
        return Response(self.get_serializer(conflict).data)
