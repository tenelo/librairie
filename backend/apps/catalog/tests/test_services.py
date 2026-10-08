from decimal import Decimal

import pytest
from rest_framework.exceptions import ValidationError

from apps.catalog.barcodes import ean13_check_digit, generate_internal_ean13, is_internal_code, is_valid_ean13
from apps.catalog.models import Article, Kit, PriceHistory
from apps.catalog.services import (
    article_availability,
    compute_kit_pricing,
    customize_kit,
    duplicate_kit,
    next_article_code,
    refresh_kits_using,
)
from apps.core.money import round_fcfa

from .factories import make_article, make_kit

pytestmark = pytest.mark.django_db


# --- Codes -----------------------------------------------------------------------------------

def test_ean13_check_digit_on_known_codes():
    assert ean13_check_digit("400638133393") == "1"
    assert is_valid_ean13("4006381333931")
    assert not is_valid_ean13("4006381333932")
    assert not is_valid_ean13("12345")


def test_internal_barcodes_are_valid_unique_and_in_store_range():
    codes = {generate_internal_ean13() for _ in range(20)}
    assert len(codes) == 20
    assert all(is_internal_code(code) for code in codes)


def test_article_codes_are_sequential_per_type():
    first, second = next_article_code("SIMPLE"), next_article_code("SIMPLE")
    assert first.startswith("ART-") and second > first
    assert next_article_code("KIT").startswith("KIT-")


def test_round_fcfa():
    assert round_fcfa(1232) == 1232
    assert round_fcfa(1232, 5) == 1230
    assert round_fcfa(1233, 5) == 1235
    assert round_fcfa(Decimal("1237.5"), 25) == 1250


# --- Prix des kits ---------------------------------------------------------------------------

@pytest.fixture
def supplies():
    return {
        "cahier": make_article("Cahier 100 pages", retail=400, cost=250),
        "stylo": make_article("Stylo bleu", retail=150, cost=80),
        "regle": make_article("Règle 30 cm", retail=300, cost=180),
        "compas": make_article("Compas", retail=1500, cost=1000),
        "compas_luxe": make_article("Compas métal", retail=2500, cost=1600),
        "couverture": make_article("Plastification", retail=200, cost=0, type_=Article.Type.SERVICE),
    }


def test_computed_kit_price_with_discount_and_rounding(supplies):
    # 6×400 + 4×150 + 1×300 = 3300 ; −7 % = 3069 → arrondi à 5 FCFA : 3070
    kit = make_kit([(supplies["cahier"], 6), (supplies["stylo"], 4), (supplies["regle"], 1)],
                   discount=Decimal("7"))
    pricing = compute_kit_pricing(kit)
    assert pricing.components_total == 3300
    assert pricing.computed_price == 3070
    assert pricing.price == 3070
    assert kit.article.retail_price == 3070
    assert pricing.cost == 6 * 250 + 4 * 80 + 180
    assert pricing.margin == 3070 - pricing.cost
    assert pricing.margin_rate == Decimal("34.9")  # 1070 / 3070
    assert kit.article.avg_cost == pricing.cost


def test_fixed_kit_price_keeps_manual_price_and_shows_margin(supplies):
    kit = make_kit([(supplies["cahier"], 6)], pricing_mode=Kit.PricingMode.FIXED, price=2000)
    pricing = compute_kit_pricing(kit)
    assert pricing.computed_price == 2400
    assert pricing.price == 2000
    assert pricing.margin == 2000 - 1500


def test_component_price_change_reprices_computed_kits(supplies):
    kit = make_kit([(supplies["cahier"], 2)])
    fixed = make_kit([(supplies["cahier"], 2)], pricing_mode=Kit.PricingMode.FIXED, price=700)
    supplies["cahier"].retail_price = 500
    supplies["cahier"].save()
    assert refresh_kits_using(supplies["cahier"]) == 1
    kit.article.refresh_from_db()
    fixed.article.refresh_from_db()
    assert kit.article.retail_price == 1000
    assert fixed.article.retail_price == 700
    assert PriceHistory.objects.filter(article=kit.article, field="retail_price", new_value="1000").exists()


# --- Disponibilité ---------------------------------------------------------------------------

def test_virtual_kit_availability_is_min_of_component_ratios(supplies):
    kit = make_kit([(supplies["cahier"], 6), (supplies["stylo"], 4), (supplies["regle"], 1, True),
                    (supplies["couverture"], 1)])
    stock = {supplies["cahier"].pk: 25, supplies["stylo"].pk: 30, supplies["regle"].pk: 0}
    # cahiers : 25 // 6 = 4 ; stylos : 30 // 4 = 7 ; règle facultative et service ignorés
    assert article_availability(kit.article, lambda pk: stock.get(pk, 0)) == 4
    stock[supplies["stylo"].pk] = 7
    assert article_availability(kit.article, lambda pk: stock.get(pk, 0)) == 1


def test_assembled_kit_uses_its_own_stock(supplies):
    kit = make_kit([(supplies["cahier"], 6)], stock_mode=Kit.StockMode.ASSEMBLED)
    stock = {kit.article.pk: 12, supplies["cahier"].pk: 0}
    assert article_availability(kit.article, lambda pk: stock.get(pk, 0)) == 12


def test_lot_and_service_availability(supplies):
    lot = make_article("Paquet de 10 stylos", retail=1300, type_=Article.Type.LOT,
                       lot_base_article=supplies["stylo"], lot_units=10)
    assert article_availability(lot, lambda pk: 35) == 3
    assert article_availability(supplies["couverture"], lambda pk: 0) is None
    assert article_availability(supplies["cahier"], lambda pk: -2) == 0


def test_virtual_kit_containing_a_lot(supplies):
    lot = make_article("Paquet de 10 stylos", retail=1300, type_=Article.Type.LOT,
                       lot_base_article=supplies["stylo"], lot_units=10)
    kit = make_kit([(lot, 1), (supplies["cahier"], 2)])
    stock = {supplies["stylo"].pk: 25, supplies["cahier"].pk: 100}
    assert article_availability(kit.article, lambda pk: stock.get(pk, 0)) == 2


# --- Personnalisation à la vente --------------------------------------------------------------

def test_remove_and_substitute_components(supplies):
    kit = make_kit([(supplies["cahier"], 6), (supplies["compas"], 1), (supplies["regle"], 1)],
                   discount=Decimal("10"))
    compas = kit.components.get(article=supplies["compas"])
    compas.substitutes.add(supplies["compas_luxe"])
    regle = kit.components.get(article=supplies["regle"])
    base = compute_kit_pricing(kit).price  # (2400 + 1500 + 300) × 0,9 = 3780

    result = customize_kit(kit, removed=[regle.pk], substitutions={compas.pk: supplies["compas_luxe"].pk})
    assert result.base_price == base == 3780
    # −300 × 0,9 = −270 ; +(2500 − 1500) × 0,9 = +900
    assert result.price == 3780 - 270 + 900
    actions = {a["action"]: a for a in result.adjustments}
    assert actions["REMOVED"]["price_delta"] == -270
    assert actions["SUBSTITUTED"]["price_delta"] == 900
    names = [line["name"] for line in result.lines]
    assert "Compas métal" in names and "Règle 30 cm" not in names


def test_substitution_must_be_an_allowed_equivalent(supplies):
    kit = make_kit([(supplies["compas"], 1)])
    component = kit.components.get()
    with pytest.raises(ValidationError):
        customize_kit(kit, substitutions={component.pk: supplies["cahier"].pk})


def test_customize_rejects_unknown_or_conflicting_components(supplies):
    kit = make_kit([(supplies["compas"], 1)])
    component = kit.components.get()
    component.substitutes.add(supplies["compas_luxe"])
    with pytest.raises(ValidationError):
        customize_kit(kit, removed=["00000000-0000-0000-0000-000000000000"])
    with pytest.raises(ValidationError):
        customize_kit(kit, removed=[component.pk], substitutions={component.pk: supplies["compas_luxe"].pk})


def test_customized_price_never_negative(supplies):
    kit = make_kit([(supplies["cahier"], 1)], pricing_mode=Kit.PricingMode.FIXED, price=100)
    component = kit.components.get()
    assert customize_kit(kit, removed=[component.pk]).price == 0


# --- Duplication -----------------------------------------------------------------------------

def test_duplicate_kit_to_another_level(supplies):
    from apps.catalog.models import SchoolLevel

    kit = make_kit([(supplies["cahier"], 6), (supplies["compas"], 1)], discount=Decimal("5"))
    kit.components.get(article=supplies["compas"]).substitutes.add(supplies["compas_luxe"])
    copy = duplicate_kit(kit, name="Kit 5ème", level=SchoolLevel.objects.get(code="5EME"))

    assert copy.pk != kit.pk and copy.article.code != kit.article.code
    assert copy.level.code == "5EME" and copy.article.name == "Kit 5ème"
    assert copy.discount_percent == Decimal("5")
    assert sorted((c.article.name, c.quantity) for c in copy.components.all()) == [
        ("Cahier 100 pages", 6), ("Compas", 1)]
    assert copy.components.get(article=supplies["compas"]).substitutes.filter(pk=supplies["compas_luxe"].pk).exists()
    assert copy.article.barcodes.count() == 1
    assert copy.article.retail_price == kit.article.retail_price
