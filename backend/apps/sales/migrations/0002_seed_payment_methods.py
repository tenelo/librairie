"""Moyens de paiement courants en Côte d'Ivoire."""
import uuid

from django.db import migrations

METHODS = [
    ("CASH", "Espèces", "CASH", False),
    ("ORANGE_MONEY", "Orange Money", "MOBILE_MONEY", True),
    ("MTN_MOMO", "MTN MoMo", "MOBILE_MONEY", True),
    ("MOOV_MONEY", "Moov Money", "MOBILE_MONEY", True),
    ("WAVE", "Wave", "MOBILE_MONEY", True),
    ("CARD", "Carte bancaire", "CARD", True),
    ("CREDIT", "Crédit client", "CREDIT", False),
    ("VOUCHER", "Bon d'achat", "VOUCHER", False),
    ("CREDIT_NOTE", "Avoir", "CREDIT_NOTE", False),
]


def seed(apps, schema_editor):
    method = apps.get_model("sales", "PaymentMethod")
    counter = apps.get_model("core", "SyncCounter")
    for order, (code, label, kind, reference) in enumerate(METHODS, start=1):
        if method.objects.filter(code=code).exists():
            continue
        row, _ = counter.objects.get_or_create(name="global", defaults={"value": 0})
        row.value += 1
        row.save(update_fields=["value"])
        method.objects.create(id=uuid.uuid4(), code=code, label=label, kind=kind, requires_reference=reference,
                              sort_order=order * 10, sync_version=row.value)


class Migration(migrations.Migration):
    dependencies = [("sales", "0001_initial"), ("core", "0001_initial")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
