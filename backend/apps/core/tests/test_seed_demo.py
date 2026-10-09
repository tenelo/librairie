import pytest
from django.core.management import call_command

from apps.accounts.models import User
from apps.catalog.models import Kit, SchoolLevel
from apps.orders.models import OnlineOrder
from apps.sales.models import Sale

pytestmark = pytest.mark.django_db


def test_seed_demo_builds_a_consistent_dataset_once(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        call_command("seed_demo", days=7)
    levels = SchoolLevel.objects.filter(is_active=True).count()
    assert Kit.objects.count() == 3 * levels  # CP1 → Terminale pour 3 établissements
    assert Kit.objects.filter(article__retail_price__gt=0).count() == Kit.objects.count()
    assert Sale.objects.filter(notes__startswith="[démo]").count() > 20
    assert set(OnlineOrder.objects.values_list("status", flat=True)) >= {"RECEIVED", "READY", "PICKED_UP"}
    roles = set(User.objects.values_list("role__code", flat=True))
    assert roles >= {"GERANT", "CAISSIER", "MAGASINIER", "PREPARATEUR", "INVENTORISTE", "CLIENT"}
    count = Sale.objects.count()
    call_command("seed_demo", days=7)  # relance sans effet
    assert Sale.objects.count() == count
