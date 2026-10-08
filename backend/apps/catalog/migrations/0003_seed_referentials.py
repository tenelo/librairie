"""Référentiels initiaux : unités, niveaux scolaires ivoiriens, catégories racines, année scolaire."""
import datetime
import uuid

from django.db import migrations

UNITS = [("U", "Unité"), ("PAQ", "Paquet"), ("RAME", "Rame"), ("BOITE", "Boîte"), ("LOT", "Lot"),
         ("M", "Mètre"), ("PAGE", "Page")]

# (code, libellé, cycle, série)
LEVELS = [
    ("CP1", "CP1", "PRIMAIRE", ""), ("CP2", "CP2", "PRIMAIRE", ""), ("CE1", "CE1", "PRIMAIRE", ""),
    ("CE2", "CE2", "PRIMAIRE", ""), ("CM1", "CM1", "PRIMAIRE", ""), ("CM2", "CM2", "PRIMAIRE", ""),
    ("6EME", "6ème", "COLLEGE", ""), ("5EME", "5ème", "COLLEGE", ""), ("4EME", "4ème", "COLLEGE", ""),
    ("3EME", "3ème", "COLLEGE", ""),
    ("2NDE-A", "2nde A", "LYCEE", "A"), ("2NDE-C", "2nde C", "LYCEE", "C"),
    ("1ERE-A", "1ère A", "LYCEE", "A"), ("1ERE-C", "1ère C", "LYCEE", "C"), ("1ERE-D", "1ère D", "LYCEE", "D"),
    ("TLE-A", "Terminale A", "LYCEE", "A"), ("TLE-C", "Terminale C", "LYCEE", "C"),
    ("TLE-D", "Terminale D", "LYCEE", "D"),
]

CATEGORIES = ["Cahiers", "Écriture", "Livres scolaires", "Papeterie", "Fournitures de bureau", "Kits scolaires",
              "Services"]


def seed(apps, schema_editor):
    counter = apps.get_model("core", "SyncCounter")

    def version():
        row, _ = counter.objects.get_or_create(name="global", defaults={"value": 0})
        row.value += 1
        row.save(update_fields=["value"])
        return row.value

    unit = apps.get_model("catalog", "Unit")
    for code, label in UNITS:
        if not unit.objects.filter(code=code).exists():
            unit.objects.create(id=uuid.uuid4(), code=code, label=label, sync_version=version())

    level = apps.get_model("catalog", "SchoolLevel")
    for order, (code, label, cycle, series) in enumerate(LEVELS, start=1):
        if not level.objects.filter(code=code).exists():
            level.objects.create(id=uuid.uuid4(), code=code, label=label, cycle=cycle, series=series,
                                 sort_order=order * 10, sync_version=version())

    category = apps.get_model("catalog", "Category")
    for order, name in enumerate(CATEGORIES, start=1):
        if not category.objects.filter(parent=None, name=name).exists():
            category.objects.create(id=uuid.uuid4(), name=name, sort_order=order * 10, sync_version=version())

    year = apps.get_model("catalog", "SchoolYear")
    if not year.objects.exists():
        year.objects.create(id=uuid.uuid4(), label="2026-2027", starts_on=datetime.date(2026, 9, 1),
                            ends_on=datetime.date(2027, 7, 31), is_current=True, sync_version=version())


class Migration(migrations.Migration):
    dependencies = [("catalog", "0002_initial"), ("core", "0001_initial")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
