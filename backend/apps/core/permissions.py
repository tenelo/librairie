"""Permissions DRF basées sur la matrice rôles / permissions de l'application `accounts`."""
from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsStaffMember(BasePermission):
    """Réservé au personnel de la librairie (tout rôle ayant accès au backoffice)."""

    message = "Accès réservé au personnel de la librairie."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return user.is_superuser or bool(user.role_id and user.role.is_staff_role)


class HasAppPermission(BasePermission):
    """Vérifie les codes de permission déclarés sur la vue.

    La vue déclare `required_permissions` sous l'une des formes :
      - une chaîne : un code exigé pour toutes les actions ;
      - un dict action → code (ou liste de codes, tous exigés), avec la clé `"*"` par défaut
        et les clés `"read"` / `"write"` pour regrouper les méthodes sûres et non sûres.
    Un code `None` signifie « authentification suffisante ».
    """

    message = "Vous n'avez pas l'autorisation d'effectuer cette action."

    def _codes_for(self, request, view):
        required = getattr(view, "required_permissions", None)
        if required is None or isinstance(required, str):
            return [required] if required else []
        action = getattr(view, "action", None)
        group = "read" if request.method in SAFE_METHODS else "write"
        for key in (action, group, "*"):
            if key in required:
                value = required[key]
                if value is None:
                    return []
                return [value] if isinstance(value, str) else list(value)
        return []

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return all(user.has_app_perm(code) for code in self._codes_for(request, view))
