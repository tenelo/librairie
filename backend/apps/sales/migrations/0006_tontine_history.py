"""Tontine : année scolaire (filtres et bilan par année) et traçabilité de la remise et de l'annulation."""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def set_current_year(apps, schema_editor):
    """Souscriptions déjà créées : rattachées à l'année scolaire en cours."""
    SchoolYear = apps.get_model("catalog", "SchoolYear")
    Tontine = apps.get_model("sales", "Tontine")
    current = SchoolYear.objects.filter(is_current=True).first()
    if current is not None:
        Tontine.objects.filter(school_year__isnull=True).update(school_year=current)


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0005_articlelibraryprice_library"),
        ("sales", "0005_tontine_subscriber"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="tontine",
            name="school_year",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name="tontines", to="catalog.schoolyear", verbose_name="année scolaire"),
        ),
        migrations.AddField(
            model_name="tontine",
            name="delivered_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name="+", to=settings.AUTH_USER_MODEL, verbose_name="remise par"),
        ),
        migrations.AddField(
            model_name="tontine",
            name="cancelled_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name="+", to=settings.AUTH_USER_MODEL, verbose_name="annulée par"),
        ),
        migrations.AddField(
            model_name="tontine",
            name="cancel_reason",
            field=models.CharField(blank=True, max_length=150, verbose_name="motif d'annulation"),
        ),
        migrations.RunPython(set_current_year, migrations.RunPython.noop),
    ]
