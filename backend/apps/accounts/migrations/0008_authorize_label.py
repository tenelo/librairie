"""L'accord du gérant (remise, retour) se donne désormais par mot de passe : libellé de la permission."""
from django.db import migrations


def relabel(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(code="sales.authorize").update(
        label="Autoriser remises et retours (mot de passe du gérant)")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0007_tontine_view_all")]

    operations = [migrations.RunPython(relabel, migrations.RunPython.noop)]
