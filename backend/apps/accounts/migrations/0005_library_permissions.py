"""Permissions liées aux librairies, ajoutées aux bases existantes.

Sur une base neuve, la migration 0002 les crée déjà avec la matrice par défaut ; ici on les crée
si elles manquent et on les accorde à l'Administrateur et au Gérant, sans toucher aux autres choix
faits par l'administrateur dans l'écran « Rôles & permissions ».
"""
from django.db import migrations

NEW_PERMISSIONS = [
    ("catalog.library_prices", "Modifier les prix de sa librairie", "Catalogue"),
    ("stock.view_all_libraries", "Voir le stock des autres librairies", "Stock"),
]
GRANTED_TO = ["ADMIN", "GERANT"]


def add_permissions(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    created = []
    for code, label, module in NEW_PERMISSIONS:
        permission, _ = Permission.objects.update_or_create(code=code, defaults={"label": label, "module": module})
        created.append(permission)
    for role in Role.objects.filter(code__in=GRANTED_TO):
        role.permissions.add(*created)


def remove_permissions(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(code__in=[c for c, _l, _m in NEW_PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0004_user_library")]

    operations = [migrations.RunPython(add_permissions, remove_permissions)]
