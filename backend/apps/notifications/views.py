from django.conf import settings
from django.db import transaction
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsStaffMember
from apps.core.request_context import get_request_device

from .events import CHANNELS, EVENTS, events_for
from .models import Notification, NotificationPreference, PushSubscription
from .serializers import (
    AuthorizationRequestSerializer,
    NotificationSerializer,
    PreferenceSerializer,
    PushSubscriptionSerializer,
)
from .services import channels_for, notify, notify_staff


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Notifications de l'utilisateur connecté (personnel ou client)."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        queryset = Notification.objects.filter(recipient=self.request.user)
        if self.request.query_params.get("unread") in ("1", "true"):
            queryset = queryset.filter(read_at__isnull=True)
        return queryset

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"])
    def unread(self, request):
        return Response({"unread": self.get_queryset().filter(read_at__isnull=True).count()})

    @extend_schema(request=None, responses=NotificationSerializer)
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_queryset().get(pk=pk)
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return Response(self.get_serializer(notification).data)

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        count = self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"marked": count, "unread": 0})


class PreferencesView(APIView):
    """Préférences par type d'événement et par canal (in-app, push, e-mail, SMS)."""

    permission_classes = [IsAuthenticated]

    def _rows(self, user):
        rows = []
        for event in events_for(user):
            enabled = set(channels_for(user, event.code))
            rows.append({"event": event.code, "label": event.label,
                         **{channel: channel in enabled for channel in CHANNELS}})
        return rows

    @extend_schema(responses=PreferenceSerializer(many=True))
    def get(self, request):
        return Response(self._rows(request.user))

    @extend_schema(request=PreferenceSerializer(many=True), responses=PreferenceSerializer(many=True))
    def put(self, request):
        serializer = PreferenceSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        allowed = {event.code for event in events_for(request.user)}
        with transaction.atomic():
            for row in serializer.validated_data:
                if row["event"] not in allowed:
                    continue
                NotificationPreference.objects.update_or_create(
                    user=request.user, event=row["event"],
                    defaults={channel: row[channel] for channel in CHANNELS})
        return Response(self._rows(request.user))


class PushSubscriptionView(APIView):
    """Abonnement Web Push du navigateur courant (clé publique VAPID, inscription, désinscription)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"public_key": settings.VAPID_PUBLIC_KEY or None,
                         "subscriptions": request.user.push_subscriptions.count()})

    @extend_schema(request=PushSubscriptionSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        serializer = PushSubscriptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        PushSubscription.objects.update_or_create(endpoint=data["endpoint"], defaults={
            "user": request.user, "p256dh": data["keys"]["p256dh"], "auth": data["keys"]["auth"],
            "app": data.get("app", "backoffice")[:20], "user_agent": request.headers.get("User-Agent", "")[:255],
            "device": get_request_device(request)})
        return Response({"subscribed": True}, status=status.HTTP_201_CREATED)

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def delete(self, request):
        endpoint = request.data.get("endpoint") or request.query_params.get("endpoint")
        deleted, _ = PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({"deleted": deleted})


class TestNotificationView(APIView):
    """Envoie une notification de test à soi-même (vérification des canaux)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses=NotificationSerializer)
    def post(self, request):
        event = events_for(request.user)[0].code
        created = notify(event, [request.user], title="Notification de test",
                         body="Les notifications fonctionnent sur cet appareil.", url="/")
        if not created:
            return Response({"detail": "Tous les canaux sont désactivés pour cet événement."}, status=400)
        return Response(NotificationSerializer(created[0]).data, status=status.HTTP_201_CREATED)


class AuthorizationRequestView(APIView):
    """Un caissier appelle un responsable (remise ou retour à autoriser par PIN)."""

    permission_classes = [IsStaffMember]

    @extend_schema(request=AuthorizationRequestSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        serializer = AuthorizationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        device = get_request_device(request)
        place = f" ({device.code})" if device else ""
        sent = notify_staff("authorization_request", title=f"Autorisation demandée par {request.user.get_full_name()}{place}",
                            body=serializer.validated_data["reason"], url="/caisse/nouvelle-vente", exclude=request.user)
        return Response({"notified": len(sent)})


class EventCatalogView(APIView):
    permission_classes = [IsStaffMember]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response([{"event": e.code, "label": e.label, "audience": e.audience, "permission": e.permission,
                          "defaults": list(e.defaults)} for e in EVENTS.values()])
