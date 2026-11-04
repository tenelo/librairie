"""Codes des dépôts d'origine alignés sur leurs nouveaux noms : BTQ « En boutique », MAG « Magasin ».

« En boutique » (code MAG) devient BTQ, puis « Magasin » (code RES) devient MAG. Seuls les dépôts
d'origine sont concernés (code, nom et type d'origine) et seulement si le nouveau code est libre.
"""
from django.db import migrations

RENAMES = [("MAG", "BTQ", "En boutique", "BOUTIQUE"), ("RES", "MAG", "Magasin", "RESERVE")]


def recode(apps, renames):
    counter = apps.get_model("core", "SyncCounter")
    depot = apps.get_model("stock", "Depot")
    for old, new, name, kind in renames:
        if depot.objects.filter(code=new).exists():
            continue
        for row in depot.objects.filter(code=old, name=name, kind=kind):
            # Nouvelle version de synchronisation : les terminaux reçoivent le nouveau code.
            sync, _ = counter.objects.get_or_create(name="global", defaults={"value": 0})
            sync.value += 1
            sync.save(update_fields=["value"])
            row.code = new
            row.sync_version = sync.value
            row.save(update_fields=["code", "sync_version"])


def forwards(apps, schema_editor):
    recode(apps, RENAMES)


def backwards(apps, schema_editor):
    recode(apps, [(new, old, name, kind) for old, new, name, kind in reversed(RENAMES)])


class Migration(migrations.Migration):

    dependencies = [
        ("stock", "0005_libelles_depots"),
        ("core", "0001_initial"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
