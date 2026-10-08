"""Vérifications transverses du projet."""
from io import StringIO

import pytest
from django.core.management import call_command

pytestmark = pytest.mark.django_db


def test_system_checks_pass():
    call_command("check", stdout=StringIO())


def test_no_missing_migrations():
    out = StringIO()
    call_command("makemigrations", "--check", "--dry-run", stdout=out)
    assert "No changes detected" in out.getvalue()


def test_ensure_admin_is_idempotent():
    from apps.accounts.models import User

    call_command("ensure_admin", "--username", "chef", "--password", "Chef-Librairie-2026", stdout=StringIO())
    call_command("ensure_admin", "--username", "chef", "--password", "Autre-2026", stdout=StringIO())
    chef = User.objects.get(username="chef")
    assert chef.is_superuser and chef.role_code == "ADMIN"
    assert chef.check_password("Chef-Librairie-2026")
