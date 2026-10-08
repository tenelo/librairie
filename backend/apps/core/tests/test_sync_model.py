import uuid

import pytest

from apps.core.models import current_sync_version, next_sync_version
from apps.settings_app.models import LibrarySettings

pytestmark = pytest.mark.django_db


def test_next_sync_version_is_strictly_increasing():
    versions = [next_sync_version() for _ in range(5)]
    assert versions == sorted(versions)
    assert len(set(versions)) == 5
    assert current_sync_version() == versions[-1]


def test_client_generated_uuid_is_kept():
    client_id = uuid.uuid4()
    obj = LibrarySettings(id=client_id, name="Librairie Terminal")
    obj.save()
    assert LibrarySettings.objects.get(pk=client_id).name == "Librairie Terminal"


def test_each_save_bumps_sync_version_and_global_cursor():
    obj = LibrarySettings.load()
    first = obj.sync_version
    obj.name = "Librairie du Plateau"
    obj.save(update_fields=["name"])
    obj.refresh_from_db()
    assert obj.sync_version > first
    assert obj.sync_version == current_sync_version()


def test_soft_delete_hides_from_default_manager_but_keeps_row():
    obj = LibrarySettings.load()
    version_before = obj.sync_version
    obj.delete()
    assert not LibrarySettings.objects.filter(pk=obj.pk).exists()
    kept = LibrarySettings.all_objects.get(pk=obj.pk)
    assert kept.is_deleted is True
    assert kept.sync_version > version_before


def test_load_returns_singleton():
    assert LibrarySettings.load().pk == LibrarySettings.load().pk
    assert LibrarySettings.all_objects.count() == 1
