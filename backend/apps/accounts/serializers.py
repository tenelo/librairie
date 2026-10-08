from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from apps.settings_app.models import LibrarySettings

from .catalog import CLIENT
from .models import Device, Permission, Role, User, normalize_phone, pin_validator


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["code", "label", "module"]


class RoleSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["code", "label", "is_staff_role", "max_discount_percent"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SlugRelatedField(
        slug_field="code", queryset=Permission.objects.all(), many=True, required=False
    )
    user_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Role
        fields = [
            "id",
            "code",
            "label",
            "description",
            "is_staff_role",
            "max_discount_percent",
            "permissions",
            "user_count",
        ]
        read_only_fields = ["id", "code", "is_staff_role", "user_count"]


def effective_offline_hours(user):
    return user.offline_max_hours or LibrarySettings.load().offline_max_hours


class ProfileSerializer(serializers.ModelSerializer):
    """Profil renvoyé à la connexion ; conservé par le terminal pour la session hors ligne."""

    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role = RoleSummarySerializer(read_only=True)
    permissions = serializers.SerializerMethodField()
    has_pin = serializers.BooleanField(read_only=True)
    offline_max_hours = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "email",
            "phone",
            "role",
            "permissions",
            "has_pin",
            "offline_max_hours",
            "must_change_password",
            "is_superuser",
        ]
        read_only_fields = [
            "id",
            "username",
            "phone",
            "role",
            "permissions",
            "has_pin",
            "offline_max_hours",
            "must_change_password",
            "is_superuser",
        ]

    def get_permissions(self, obj) -> list[str]:
        return sorted(obj.get_app_permissions())

    def get_offline_max_hours(self, obj) -> int:
        return effective_offline_hours(obj)


class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField(help_text="Identifiant ou numéro de téléphone")
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    app = serializers.ChoiceField(choices=["backoffice", "boutique"], default="backoffice")


class TokenPairSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()
    user = ProfileSerializer()


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Mot de passe actuel incorrect.")
        return value

    def validate_new_password(self, value):
        validate_password(value, self.context["request"].user)
        return value


class SetPinSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False, help_text="Mot de passe actuel, par sécurité")
    pin = serializers.CharField(validators=[pin_validator])

    def validate_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Mot de passe incorrect.")
        return value


class VerifyPinSerializer(serializers.Serializer):
    username = serializers.CharField()
    pin = serializers.CharField(validators=[pin_validator])
    permission = serializers.CharField(required=False, allow_blank=True)


class RegisterSerializer(serializers.Serializer):
    """Inscription d'un client de la boutique en ligne (téléphone + mot de passe)."""

    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=20)
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(trim_whitespace=False)

    def validate_phone(self, value):
        phone = normalize_phone(value)
        if not phone or len(phone.lstrip("+")) < 8:
            raise serializers.ValidationError("Numéro de téléphone invalide.")
        if User.objects.filter(phone=phone).exists() or User.objects.filter(username__iexact=phone).exists():
            raise serializers.ValidationError("Un compte existe déjà avec ce numéro.")
        return phone

    def validate_password(self, value):
        validate_password(value)
        return value

    @transaction.atomic
    def create(self, validated_data):
        user = User(
            username=validated_data["phone"],
            phone=validated_data["phone"],
            first_name=validated_data["first_name"],
            last_name=validated_data["last_name"],
            email=validated_data.get("email", ""),
            role=Role.objects.get(code=CLIENT),
        )
        user.set_password(validated_data["password"])
        user.save()
        return user


class UserSerializer(serializers.ModelSerializer):
    """Gestion des utilisateurs par l'administrateur."""

    role = serializers.SlugRelatedField(slug_field="code", queryset=Role.objects.all())
    role_label = serializers.CharField(source="role.label", read_only=True, default=None)
    full_name = serializers.CharField(source="get_full_name", read_only=True)
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)
    has_pin = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "email",
            "phone",
            "role",
            "role_label",
            "is_active",
            "offline_max_hours",
            "must_change_password",
            "has_pin",
            "last_login",
            "date_joined",
            "password",
        ]
        read_only_fields = ["id", "full_name", "role_label", "has_pin", "last_login", "date_joined"]

    def validate_phone(self, value):
        phone = normalize_phone(value)
        if phone and User.objects.exclude(pk=getattr(self.instance, "pk", None)).filter(phone=phone).exists():
            raise serializers.ValidationError("Ce numéro est déjà utilisé.")
        return phone

    def validate(self, attrs):
        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError({"password": "Le mot de passe est obligatoire à la création."})
        if attrs.get("password"):
            candidate = self.instance or User(username=attrs.get("username", ""))
            validate_password(attrs["password"], candidate)
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class DeviceSerializer(serializers.ModelSerializer):
    # Champ redéclaré : le code est mis en majuscules avant le contrôle de format du modèle.
    code = serializers.CharField(max_length=10)
    registered_by_name = serializers.CharField(source="registered_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = Device
        fields = [
            "id",
            "code",
            "name",
            "kind",
            "is_active",
            "last_seen_at",
            "last_sync_at",
            "registered_by",
            "registered_by_name",
            "created_at",
        ]
        read_only_fields = ["id", "last_seen_at", "last_sync_at", "registered_by", "registered_by_name", "created_at"]

    def validate_code(self, value):
        code = value.strip().upper()
        try:
            Device._meta.get_field("code").run_validators(code)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        if Device.objects.exclude(pk=getattr(self.instance, "pk", None)).filter(code=code).exists():
            raise serializers.ValidationError("Ce code terminal est déjà attribué.")
        return code
