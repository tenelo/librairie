from django.db.models import Count
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.core.permissions import HasAppPermission, IsStaffMember
from apps.core.request_context import get_request_device

from .models import Device, Permission, Role, User
from .serializers import (
    ChangePasswordSerializer,
    DeviceSerializer,
    LoginSerializer,
    LogoutSerializer,
    PermissionSerializer,
    ProfileSerializer,
    RegisterSerializer,
    RoleSerializer,
    SetPinSerializer,
    TokenPairSerializer,
    UserSerializer,
    VerifyPinSerializer,
)

INVALID_CREDENTIALS = "Identifiant ou mot de passe incorrect."


def issue_tokens(user, device=None):
    """Émet la paire de jetons JWT avec quelques informations utiles au client."""
    refresh = RefreshToken.for_user(user)
    refresh["role"] = user.role_code
    if device is not None:
        refresh["device"] = device.code
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": ProfileSerializer(user).data}


def touch_device(device):
    if device is not None:
        device.last_seen_at = timezone.now()
        device.save(update_fields=["last_seen_at", "updated_at"])


class LoginView(APIView):
    """Connexion par identifiant (ou téléphone) et mot de passe.

    Les échecs renvoient une réponse 401 sans lever d'exception : la transaction de la requête
    n'est donc pas annulée et l'échec reste bien inscrit au journal d'audit.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "auth"

    @extend_schema(request=LoginSerializer, responses={200: TokenPairSerializer})
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifier = serializer.validated_data["identifier"]
        user = User.objects.get_by_identifier(identifier)
        device = get_request_device(request)

        if user is None or not user.is_active or not user.check_password(serializer.validated_data["password"]):
            log_event(
                AuditLog.Action.LOGIN_FAILED,
                request=request,
                user=user if user and user.is_active else None,
                username=identifier,
                entity="User",
                entity_id=user.id if user else "",
                description="Identifiants invalides",
                device=device,
            )
            return Response({"detail": INVALID_CREDENTIALS}, status=status.HTTP_401_UNAUTHORIZED)

        app = serializer.validated_data["app"]
        is_staff = user.is_superuser or bool(user.role_id and user.role.is_staff_role)
        if app == "backoffice" and not is_staff:
            log_event(
                AuditLog.Action.LOGIN_FAILED,
                request=request,
                user=user,
                entity="User",
                entity_id=user.id,
                description="Accès au backoffice refusé (compte client)",
                device=device,
            )
            return Response(
                {"detail": "Ce compte n'a pas accès au backoffice."}, status=status.HTTP_403_FORBIDDEN
            )

        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        touch_device(device)
        log_event(
            AuditLog.Action.LOGIN,
            request=request,
            user=user,
            entity="User",
            entity_id=user.id,
            description=f"Connexion {app}",
            device=device,
        )
        return Response(issue_tokens(user, device))


class RefreshView(TokenRefreshView):
    throttle_scope = "auth"


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=LogoutSerializer, responses={205: None})
    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data["refresh"]).blacklist()
        except TokenError:
            pass
        log_event(AuditLog.Action.LOGOUT, request=request, entity="User", entity_id=request.user.id)
        return Response(status=status.HTTP_205_RESET_CONTENT)


class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "register"

    @extend_schema(request=RegisterSerializer, responses={201: TokenPairSerializer})
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        log_event(
            AuditLog.Action.CREATE,
            request=request,
            user=user,
            entity="User",
            entity_id=user.id,
            description="Inscription client boutique",
        )
        return Response(issue_tokens(user), status=status.HTTP_201_CREATED)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=ProfileSerializer)
    def get(self, request):
        return Response(ProfileSerializer(request.user).data)

    @extend_schema(request=ProfileSerializer, responses=ProfileSerializer)
    def patch(self, request):
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "auth"

    @extend_schema(request=ChangePasswordSerializer, responses={204: None})
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data["new_password"])
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        log_event(AuditLog.Action.PASSWORD_CHANGE, request=request, entity="User", entity_id=user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SetPinView(APIView):
    """Définit le PIN de l'utilisateur connecté (utilisé pour les relais de caisse et autorisations)."""

    permission_classes = [IsStaffMember]
    throttle_scope = "auth"

    @extend_schema(request=SetPinSerializer, responses={204: None})
    def post(self, request):
        serializer = SetPinSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_pin(serializer.validated_data["pin"])
        user.save(update_fields=["pin_hash"])
        log_event(AuditLog.Action.PIN_SET, request=request, entity="User", entity_id=user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class VerifyPinView(APIView):
    """Vérifie le PIN d'un utilisateur, par exemple pour qu'un gérant autorise une remise en ligne."""

    permission_classes = [IsStaffMember]
    throttle_scope = "auth"

    @extend_schema(
        request=VerifyPinSerializer,
        responses=inline_serializer(
            "VerifyPinResult",
            {
                "valid": serializers.BooleanField(),
                "has_permission": serializers.BooleanField(),
                "user": ProfileSerializer(allow_null=True),
            },
        ),
    )
    def post(self, request):
        serializer = VerifyPinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        target = User.objects.filter(username__iexact=data["username"], is_active=True).first()
        if target is None or not target.check_pin(data["pin"]):
            log_event(
                AuditLog.Action.PIN_FAILED,
                request=request,
                entity="User",
                entity_id=target.id if target else "",
                description=f"PIN invalide pour {data['username']}",
            )
            return Response({"valid": False, "has_permission": False, "user": None})
        permission = data.get("permission") or ""
        has_permission = target.has_app_perm(permission) if permission else True
        log_event(
            AuditLog.Action.PIN_UNLOCK,
            request=request,
            entity="User",
            entity_id=target.id,
            description=f"PIN de {target.username} vérifié" + (f" pour {permission}" if permission else ""),
        )
        return Response({"valid": True, "has_permission": has_permission, "user": ProfileSerializer(target).data})


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [IsStaffMember]
    pagination_class = None
    lookup_field = "code"


class RoleViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Rôles fixes ; seuls le libellé, la remise maximale et la matrice de permissions sont modifiables."""

    serializer_class = RoleSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "accounts.manage_roles"}
    pagination_class = None

    def get_queryset(self):
        # Django ignore Meta.ordering dès qu'il y a agrégation : l'ordre doit être explicite.
        return Role.objects.prefetch_related("permissions").annotate(user_count=Count("user")).order_by("id")

    def perform_update(self, serializer):
        role = serializer.instance
        old_permissions = sorted(role.permissions.values_list("code", flat=True))
        old = {"label": role.label, "max_discount_percent": role.max_discount_percent, "permissions": old_permissions}
        role = serializer.save()
        new_permissions = sorted(role.permissions.values_list("code", flat=True))
        new = {"label": role.label, "max_discount_percent": role.max_discount_percent, "permissions": new_permissions}
        log_event(
            AuditLog.Action.PERMISSIONS_CHANGE,
            request=self.request,
            entity="Role",
            entity_id=role.code,
            description=f"Modification du rôle {role.label}",
            old_values=old,
            new_values=new,
        )


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                  mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Gestion des utilisateurs. Pas de suppression : un utilisateur se désactive."""

    serializer_class = UserSerializer
    permission_classes = [HasAppPermission]
    required_permissions = "accounts.manage_users"
    filterset_fields = ["role__code", "is_active"]
    search_fields = ["username", "first_name", "last_name", "phone", "email"]
    ordering_fields = ["username", "last_name", "last_login", "date_joined"]

    def get_queryset(self):
        return User.objects.select_related("role").all()

    def perform_create(self, serializer):
        user = serializer.save()
        log_event(
            AuditLog.Action.CREATE,
            request=self.request,
            entity="User",
            entity_id=user.id,
            description=f"Création de l'utilisateur {user.username}",
            new_values={"username": user.username, "role": user.role_code},
        )

    def perform_update(self, serializer):
        before = {"role": serializer.instance.role_code, "is_active": serializer.instance.is_active}
        user = serializer.save()
        log_event(
            AuditLog.Action.UPDATE,
            request=self.request,
            entity="User",
            entity_id=user.id,
            description=f"Modification de l'utilisateur {user.username}",
            old_values=before,
            new_values={"role": user.role_code, "is_active": user.is_active},
        )

    @extend_schema(request=None, responses=UserSerializer)
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        if user == request.user:
            return Response({"detail": "Vous ne pouvez pas désactiver votre propre compte."}, status=400)
        user.is_active = False
        user.save(update_fields=["is_active"])
        log_event(AuditLog.Action.UPDATE, request=request, entity="User", entity_id=user.id,
                  description=f"Désactivation de {user.username}", old_values={"is_active": True},
                  new_values={"is_active": False})
        return Response(UserSerializer(user).data)

    @extend_schema(request=None, responses=UserSerializer)
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        user = self.get_object()
        user.is_active = True
        user.save(update_fields=["is_active"])
        log_event(AuditLog.Action.UPDATE, request=request, entity="User", entity_id=user.id,
                  description=f"Réactivation de {user.username}", old_values={"is_active": False},
                  new_values={"is_active": True})
        return Response(UserSerializer(user).data)

    @extend_schema(request=None, responses={204: None})
    @action(detail=True, methods=["post"], url_path="reset-pin")
    def reset_pin(self, request, pk=None):
        user = self.get_object()
        user.pin_hash = ""
        user.save(update_fields=["pin_hash"])
        log_event(AuditLog.Action.UPDATE, request=request, entity="User", entity_id=user.id,
                  description=f"Réinitialisation du PIN de {user.username}")
        return Response(status=status.HTTP_204_NO_CONTENT)


class DeviceViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                    mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Terminaux. Un terminal ne se supprime pas (ses reçus portent son code) : il se désactive."""

    queryset = Device.objects.select_related("registered_by").all()
    serializer_class = DeviceSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"check": None, "*": "accounts.manage_devices"}
    filterset_fields = ["kind", "is_active"]
    search_fields = ["code", "name"]

    def perform_create(self, serializer):
        device = serializer.save(registered_by=self.request.user)
        log_event(AuditLog.Action.CREATE, request=self.request, entity="Device", entity_id=device.id,
                  description=f"Enregistrement du terminal {device.code}",
                  new_values={"code": device.code, "name": device.name, "kind": device.kind})

    def perform_update(self, serializer):
        before = {"code": serializer.instance.code, "name": serializer.instance.name,
                  "is_active": serializer.instance.is_active}
        device = serializer.save()
        log_event(AuditLog.Action.UPDATE, request=self.request, entity="Device", entity_id=device.id,
                  description=f"Modification du terminal {device.code}", old_values=before,
                  new_values={"code": device.code, "name": device.name, "is_active": device.is_active})

    @extend_schema(
        parameters=[OpenApiParameter("code", str, required=True)],
        responses={200: DeviceSerializer, 404: None},
    )
    @action(detail=False, methods=["get"])
    def check(self, request):
        """Permet à un poste de vérifier que le code terminal saisi localement est enregistré et actif."""
        code = (request.query_params.get("code") or "").strip().upper()
        device = Device.objects.filter(code=code, is_active=True).first()
        if device is None:
            return Response({"detail": "Terminal inconnu ou désactivé."}, status=status.HTTP_404_NOT_FOUND)
        touch_device(device)
        return Response(DeviceSerializer(device).data)
