"""Permission « Voir les souscriptions de toutes les librairies » (tontine scolaire).

Accordée par défaut à l'Administrateur et au Gérant ; l'administrateur la donne à d'autres rôles
dans l'écran « Rôles & permissions ».
"""
from django.db import migrations

CODE = "tontines.view_all"
GRANTED_TO = ["ADMIN", "GERANT"]


def add_permission(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.update_or_create(
        code=CODE, defaults={"label": "Voir les souscriptions de toutes les librairies", "module": "Clients"})
    for role in Role.objects.filter(code__in=GRANTED_TO):
        role.permissions.add(permission)


def remove_permission(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(code=CODE).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0006_tontine_permissions")]

    operations = [migrations.RunPython(add_permission, remove_permission)]
