from django.db import migrations


def seed(apps, schema_editor):
    from apps.accounts.catalog import sync_permissions_and_roles

    sync_permissions_and_roles(apps.get_model("accounts", "Permission"), apps.get_model("accounts", "Role"))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
