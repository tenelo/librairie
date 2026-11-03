"""Tontine simplifiée : nom et prénoms + téléphone du souscripteur (client facultatif)."""
import django.db.models.deletion
from django.db import migrations, models


def copy_customer(apps, schema_editor):
    """Tontines déjà souscrites : le souscripteur reprend le nom et le téléphone du client."""
    Tontine = apps.get_model("sales", "Tontine")
    for tontine in Tontine.objects.select_related("customer").filter(customer__isnull=False):
        tontine.subscriber_name = tontine.customer.name[:150]
        tontine.subscriber_phone = (tontine.customer.phone or "")[:20]
        tontine.save(update_fields=["subscriber_name", "subscriber_phone"])


class Migration(migrations.Migration):
    dependencies = [
        ("customers", "0002_customer"),
        ("sales", "0004_tontine"),
    ]

    operations = [
        migrations.AddField(
            model_name="tontine",
            name="subscriber_name",
            field=models.CharField(default="", max_length=150, verbose_name="nom et prénoms du souscripteur"),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="tontine",
            name="subscriber_phone",
            field=models.CharField(blank=True, db_index=True, max_length=20, verbose_name="téléphone"),
        ),
        migrations.AlterField(
            model_name="tontine",
            name="customer",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name="tontines", to="customers.customer"),
        ),
        migrations.RunPython(copy_customer, migrations.RunPython.noop),
        migrations.RemoveField(model_name="tontine", name="beneficiaries"),
        migrations.RemoveField(model_name="tontine", name="due_date"),
    ]
