"""Dépôts initiaux : le magasin (point de retrait, par défaut) et la réserve."""
import uuid

from django.db import migrations


def seed(apps, schema_editor):
    counter = apps.get_model("core", "SyncCounter")
    depot = apps.get_model("stock", "Depot")
    if depot.objects.exists():
        return
    for code, name, kind, pickup, default in [("MAG", "Magasin", "BOUTIQUE", True, True),
                                               ("RES", "Réserve", "RESERVE", False, False)]:
        row, _ = counter.objects.get_or_create(name="global", defaults={"value": 0})
        row.value += 1
        row.save(update_fields=["value"])
        depot.objects.create(id=uuid.uuid4(), code=code, name=name, kind=kind, is_pickup_point=pickup,
                             is_default=default, sync_version=row.value)


class Migration(migrations.Migration):
    dependencies = [("stock", "0001_initial"), ("core", "0001_initial")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
