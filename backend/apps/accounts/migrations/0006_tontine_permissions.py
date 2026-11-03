"""Permissions de la tontine scolaire, ajoutées aux bases existantes.

Sur une base neuve, la migration 0002 les crée déjà avec la matrice par défaut ; ici on les crée
si elles manquent et on les accorde selon la matrice par défaut, sans toucher aux autres choix
faits par l'administrateur dans l'écran « Rôles & permissions ».
"""
from django.db import migrations

NEW_PERMISSIONS = [
    ("tontines.view", "Consulter les tontines scolaires", "Clients"),
    ("tontines.manage", "Souscrire des tontines et encaisser les versements", "Clients"),
    ("tontines.cancel", "Annuler une tontine et rembourser le client", "Clients"),
]
GRANTS = {
    "ADMIN": ["tontines.view", "tontines.manage", "tontines.cancel"],
    "GERANT": ["tontines.view", "tontines.manage", "tontines.cancel"],
    "CAISSIER": ["tontines.view", "tontines.manage"],
}


def add_permissions(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    by_code = {}
    for code, label, module in NEW_PERMISSIONS:
        by_code[code], _ = Permission.objects.update_or_create(code=code, defaults={"label": label, "module": module})
    for role in Role.objects.filter(code__in=GRANTS):
        role.permissions.add(*[by_code[code] for code in GRANTS[role.code]])


def remove_permissions(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(code__in=[c for c, _l, _m in NEW_PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0005_library_permissions")]

    operations = [migrations.RunPython(add_permissions, remove_permissions)]
