from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source="get_action_display", read_only=True)
    origin_label = serializers.CharField(source="get_origin_display", read_only=True)
    device_code = serializers.CharField(source="device.code", read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "action",
            "action_label",
            "entity",
            "entity_id",
            "description",
            "user",
            "username",
            "role_code",
            "device",
            "device_code",
            "ip_address",
            "server_timestamp",
            "client_timestamp",
            "old_values",
            "new_values",
            "origin",
            "origin_label",
        ]
        read_only_fields = fields
