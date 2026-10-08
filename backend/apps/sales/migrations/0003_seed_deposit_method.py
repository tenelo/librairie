"""Moyen de paiement « Acompte en ligne » : imputation, à la caisse, de l'acompte payé sur la boutique."""
import uuid

from django.db import migrations, models


def seed(apps, schema_editor):
    method = apps.get_model("sales", "PaymentMethod")
    counter = apps.get_model("core", "SyncCounter")
    if method.objects.filter(code="ONLINE_DEPOSIT").exists():
        return
    row, _ = counter.objects.get_or_create(name="global", defaults={"value": 0})
    row.value += 1
    row.save(update_fields=["value"])
    method.objects.create(id=uuid.uuid4(), code="ONLINE_DEPOSIT", label="Acompte en ligne", kind="DEPOSIT",
                          requires_reference=False, sort_order=100, sync_version=row.value)


class Migration(migrations.Migration):
    dependencies = [("sales", "0002_seed_payment_methods")]

    operations = [
        migrations.AlterField(
            model_name="paymentmethod",
            name="kind",
            field=models.CharField(choices=[("CASH", "Espèces"), ("MOBILE_MONEY", "Mobile Money"),
                                            ("CARD", "Carte bancaire"), ("CREDIT", "Crédit client"),
                                            ("VOUCHER", "Bon d'achat"), ("CREDIT_NOTE", "Avoir"),
                                            ("DEPOSIT", "Acompte en ligne")],
                                   max_length=15, verbose_name="type"),
        ),
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
