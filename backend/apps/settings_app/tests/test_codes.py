import pytest
from django.utils import timezone

from apps.catalog.models import Article
from apps.catalog.services import next_article_code
from apps.core.numbering import next_document_number

pytestmark = pytest.mark.django_db
URL = "/api/settings/codes/"


def test_codes_listed_with_next_number(auth_client, admin_user):
    year = timezone.localdate().year
    next_document_number("TR")
    rows = {r["key"]: r for r in auth_client(admin_user).get(URL).json()}
    assert rows["TR"]["prefix"] == "TR" and rows["TR"]["last_code"] == f"TR-{year}-00001"
    assert rows["TR"]["next_code"] == f"TR-{year}-00002"
    assert rows["ART"]["next_code"].startswith("ART-")


def test_prefix_and_width_change_new_codes_only(auth_client, admin_user):
    year = timezone.localdate().year
    client = auth_client(admin_user)
    assert next_document_number("TR") == f"TR-{year}-00001"
    response = client.patch(URL + "TR/", {"prefix": "trf", "width": 4}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["next_code"] == f"TRF-{year}-0001"
    assert next_document_number("TR") == f"TRF-{year}-0001"
    assert client.patch(URL + "ART/", {"prefix": "PRD"}, format="json").status_code == 200
    assert next_article_code(Article.Type.SIMPLE).startswith("PRD-")
    # Retour aux valeurs par défaut : le compteur TR reprend où il en était.
    assert client.patch(URL + "TR/", {"prefix": "TR", "width": 5}, format="json").status_code == 200
    assert next_document_number("TR") == f"TR-{year}-00002"


def test_invalid_or_duplicate_prefix_refused(auth_client, admin_user, cashier_user):
    client = auth_client(admin_user)
    assert client.patch(URL + "TR/", {"prefix": "INV"}, format="json").status_code == 400
    assert client.patch(URL + "TR/", {"prefix": "T R"}, format="json").status_code == 400
    assert client.patch(URL + "TR/", {"width": 12}, format="json").status_code == 400
    assert client.patch(URL + "XX/", {"prefix": "XX"}, format="json").status_code == 404
    assert auth_client(cashier_user).get(URL).status_code == 403
