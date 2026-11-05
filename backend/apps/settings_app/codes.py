"""Administration › Codes et numérotation : préfixe et nombre de chiffres de chaque type de code.

Les numéros restent attribués par le serveur (compteurs non modifiables). Changer un préfixe fait
repartir son compteur à 1 : les codes déjà émis ne changent pas et aucun doublon n'est possible.
"""
import re

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.core.models import CodeSetting
from apps.core.numbering import CODE_RULES, code_format, current_counter, format_code
from apps.core.permissions import HasAppPermission, IsStaffMember

PREFIX_RE = re.compile(r"^[A-Z][A-Z0-9]{0,5}$")
MIN_WIDTH, MAX_WIDTH = 3, 8


def describe(key: str) -> dict:
    rule = CODE_RULES[key]
    prefix, width = code_format(key)
    last = current_counter(key, prefix)
    return {
        "key": key, "label": rule.label, "kind": rule.kind, "default_prefix": key, "default_width": rule.width,
        "prefix": prefix, "width": width, "last_number": last,
        "last_code": format_code(key, prefix, width, last) if last else None,
        "next_code": format_code(key, prefix, width, last + 1),
    }


class CodeSettingsView(APIView):
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "settings.manage", "write": "settings.manage"}

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response([describe(key) for key in CODE_RULES])


class CodeSettingDetailView(APIView):
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "settings.manage", "write": "settings.manage"}

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def patch(self, request, key):
        if key not in CODE_RULES:
            return Response({"detail": "Type de code inconnu."}, status=status.HTTP_404_NOT_FOUND)
        old_prefix, old_width = code_format(key)
        prefix = str(request.data.get("prefix", old_prefix)).strip().upper()
        try:
            width = int(request.data.get("width", old_width))
        except (TypeError, ValueError):
            return Response({"width": "Nombre de chiffres invalide."}, status=status.HTTP_400_BAD_REQUEST)
        if not PREFIX_RE.match(prefix):
            return Response({"prefix": "1 à 6 caractères : lettres majuscules et chiffres, commençant par une lettre."},
                            status=status.HTTP_400_BAD_REQUEST)
        if not MIN_WIDTH <= width <= MAX_WIDTH:
            return Response({"width": f"Entre {MIN_WIDTH} et {MAX_WIDTH} chiffres."}, status=status.HTTP_400_BAD_REQUEST)
        taken = {code_format(other)[0]: CODE_RULES[other].label for other in CODE_RULES if other != key}
        if prefix in taken:
            return Response({"prefix": f"Préfixe déjà utilisé pour : {taken[prefix]}."},
                            status=status.HTTP_400_BAD_REQUEST)
        if (prefix, width) == (key, CODE_RULES[key].width):
            CodeSetting.objects.filter(key=key).delete()  # retour aux valeurs par défaut
        else:
            CodeSetting.objects.update_or_create(key=key, defaults={"prefix": prefix, "width": width})
        log_event(AuditLog.Action.UPDATE, request=request, entity="CodeSetting", entity_id=key,
                  description=f"Codes « {CODE_RULES[key].label} » : {old_prefix}/{old_width} → {prefix}/{width}",
                  old_values={"prefix": old_prefix, "width": old_width}, new_values={"prefix": prefix, "width": width})
        return Response(describe(key))
