from rest_framework import serializers

from .models import School


class SchoolSerializer(serializers.ModelSerializer):
    kit_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = School
        fields = ["id", "name", "city", "district", "phone", "is_active", "kit_count", "sync_version", "updated_at"]
        read_only_fields = ["kit_count", "sync_version", "updated_at"]
        # L'unicité (nom, ville) est contrôlée par la base ; message clair ci-dessous.
        validators = []

    def validate(self, attrs):
        name = attrs.get("name", getattr(self.instance, "name", ""))
        city = attrs.get("city", getattr(self.instance, "city", ""))
        duplicates = School.objects.filter(name__iexact=name, city__iexact=city)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError({"name": "Un établissement de ce nom existe déjà dans cette ville."})
        return attrs
