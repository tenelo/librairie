"""Nouveaux libellés des dépôts : « En boutique » (stock en rayon) et « Magasin » (arrière-boutique).

Les deux dépôts créés à l'installation sont renommés s'ils portent encore leur nom d'origine
(« Magasin » → « En boutique », puis « Réserve » → « Magasin ») ; un nom déjà modifié est conservé.
"""
from django.db import migrations, models

RENAMES = [("MAG", "Magasin", "En boutique"), ("RES", "Réserve", "Magasin")]


def rename(apps, schema_editor, renames):
    counter = apps.get_model("core", "SyncCounter")
    depot = apps.get_model("stock", "Depot")
    for code, old, new in renames:
        for row in depot.objects.filter(code=code, name=old):
            # Nouvelle version de synchronisation : les terminaux reçoivent le nouveau nom.
            sync, _ = counter.objects.get_or_create(name="global", defaults={"value": 0})
            sync.value += 1
            sync.save(update_fields=["value"])
            row.name = new
            row.sync_version = sync.value
            row.save(update_fields=["name", "sync_version"])


def forwards(apps, schema_editor):
    rename(apps, schema_editor, RENAMES)


def backwards(apps, schema_editor):
    rename(apps, schema_editor, [(code, new, old) for code, old, new in reversed(RENAMES)])


class Migration(migrations.Migration):

    dependencies = [
        ("stock", "0004_library_receipt"),
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="depot",
            name="kind",
            field=models.CharField(
                choices=[("BOUTIQUE", "En boutique"), ("RESERVE", "Magasin")],
                default="BOUTIQUE",
                max_length=10,
                verbose_name="type",
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
