import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import User
from apps.sales.models import Tontine

pytestmark = pytest.mark.django_db


def test_seed_demo_tontines_requires_kits():
    User.objects.create_superuser("admin", password="x")
    with pytest.raises(CommandError):
        call_command("seed_demo_tontines")


def test_seed_demo_tontines_creates_varied_subscriptions_once(django_capture_on_commit_callbacks):
    User.objects.create_superuser("admin", password="x")
    with django_capture_on_commit_callbacks(execute=True):
        call_command("seed_demo", days=7)
    call_command("seed_demo_tontines", count=8)
    demo = Tontine.objects.filter(notes__startswith="[démo]")
    assert demo.count() == 8
    for tontine in demo:
        assert tontine.target_amount > 0 and tontine.lines.exists()
        assert 0 <= tontine.paid_amount <= tontine.target_amount
        assert tontine.paid_amount == sum(p.amount for p in tontine.payments.all())
    call_command("seed_demo_tontines")  # relance sans effet
    assert Tontine.objects.count() == 8
