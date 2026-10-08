from django.conf import settings
from django.db import connection
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """Sonde de santé utilisée par Docker, nginx et l'indicateur réseau des PWA."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        responses=inline_serializer(
            "Health",
            {
                "status": serializers.CharField(),
                "database": serializers.CharField(),
                "server_time": serializers.DateTimeField(),
                "timezone": serializers.CharField(),
                "currency": serializers.CharField(),
            },
        )
    )
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            database = "ok"
        except Exception:  # pragma: no cover - dépend de l'infrastructure
            database = "indisponible"
        return Response(
            {
                "status": "ok" if database == "ok" else "degraded",
                "database": database,
                "server_time": timezone.now(),
                "timezone": settings.TIME_ZONE,
                "currency": settings.CURRENCY_CODE,
            }
        )
