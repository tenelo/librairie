"""Crée les paramètres par défaut pour qu'ils soient transmis aux terminaux dès la première synchronisation."""
import uuid

from django.db import migrations


def create_default(apps, schema_editor):
    settings_model = apps.get_model("settings_app", "LibrarySettings")
    if settings_model.objects.exists():
        return
    counter = apps.get_model("core", "SyncCounter")
    row, _ = counter.objects.get_or_create(name="global", defaults={"value": 0})
    row.value += 1
    row.save(update_fields=["value"])
    settings_model.objects.create(id=uuid.uuid4(), sync_version=row.value)


class Migration(migrations.Migration):
    dependencies = [("settings_app", "0002_librarysettings_price_rounding"), ("core", "0001_initial")]

    operations = [migrations.RunPython(create_default, migrations.RunPython.noop)]
