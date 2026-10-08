from rest_framework import serializers

from .models import Customer, School


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


class CustomerSerializer(serializers.ModelSerializer):
    school_name = serializers.CharField(source="school.name", read_only=True, default=None)
    credit_balance = serializers.SerializerMethodField()
    loyalty_points = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = ["id", "name", "phone", "email", "address", "school", "school_name", "credit_limit",
                  "credit_balance", "loyalty_points", "notes", "is_active", "sync_version", "updated_at"]
        read_only_fields = ["sync_version", "updated_at"]

    def get_credit_balance(self, obj) -> int:
        from apps.sales.services import customer_balance

        return customer_balance(obj)

    def get_loyalty_points(self, obj) -> int:
        from apps.sales.services import loyalty_balance

        return loyalty_balance(obj)
