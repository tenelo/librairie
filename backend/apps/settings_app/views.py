from drf_spectacular.utils import extend_schema
from rest_framework import generics
from rest_framework.permissions import AllowAny

from apps.audit.models import AuditLog
from apps.audit.services import diff_values, log_event
from apps.core.permissions import HasAppPermission, IsStaffMember

from .models import LibrarySettings
from .serializers import LibrarySettingsSerializer, PublicLibrarySettingsSerializer


class LibrarySettingsView(generics.RetrieveUpdateAPIView):
    """Lecture par tout le personnel ; modification réservée à `settings.manage`."""

    serializer_class = LibrarySettingsSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "settings.manage"}

    def get_object(self):
        return LibrarySettings.load()

    def perform_update(self, serializer):
        before = dict(LibrarySettingsSerializer(serializer.instance).data)
        instance = serializer.save()
        after = dict(LibrarySettingsSerializer(instance).data)
        for technical in ("sync_version", "updated_at"):
            before.pop(technical, None)
            after.pop(technical, None)
        old, new = diff_values(before, after)
        log_event(
            AuditLog.Action.UPDATE,
            request=self.request,
            entity="LibrarySettings",
            entity_id=instance.id,
            description="Modification des paramètres de la librairie",
            old_values=old,
            new_values=new,
        )


@extend_schema(responses=PublicLibrarySettingsSerializer)
class PublicLibrarySettingsView(generics.RetrieveAPIView):
    serializer_class = PublicLibrarySettingsSerializer
    permission_classes = [AllowAny]
    authentication_classes = []

    def get_object(self):
        return LibrarySettings.load()
