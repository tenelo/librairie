from rest_framework import serializers

from .models import Notification, PushSubscription


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "event", "title", "body", "url", "data", "read_at", "created_at"]


class PreferenceSerializer(serializers.Serializer):
    event = serializers.CharField()
    label = serializers.CharField(read_only=True)
    in_app = serializers.BooleanField()
    push = serializers.BooleanField()
    email = serializers.BooleanField()
    sms = serializers.BooleanField()


class PushSubscriptionSerializer(serializers.ModelSerializer):
    keys = serializers.DictField(child=serializers.CharField(), write_only=True)

    class Meta:
        model = PushSubscription
        fields = ["endpoint", "keys", "app"]

    def validate_keys(self, value):
        if not value.get("p256dh") or not value.get("auth"):
            raise serializers.ValidationError("Clés d'abonnement incomplètes.")
        return value


class AuthorizationRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300)
