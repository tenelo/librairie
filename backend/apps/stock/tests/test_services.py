import uuid

import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.exceptions import ValidationError

from apps.catalog.models import Article, Kit
from apps.catalog.services import article_availability
from apps.catalog.tests.factories import make_article, make_kit
from apps.stock.models import Depot, KitAssembly, StockAlert, StockLevel, StockMovement, StockTransfer, \
    StockTransferLine
from apps.stock.services import (
    InsufficientStock,
    adjust,
    assemble_kits,
    available,
    on_hand,
    rebuild_stock_levels,
    record_movement,
    refresh_alerts,
    stock_card,
    stock_lookup,
    update_average_cost,
    validate_transfer,
)

pytestmark = pytest.mark.django_db
Kind = StockMovement.Kind


@pytest.fixture
def mag():
    return Depot.objects.get(code="MAG")


@pytest.fixture
def res():
    return Depot.objects.get(code="RES")


def test_seeded_depots(mag, res):
    assert Depot.default() == mag and mag.is_pickup_point
    assert res.kind == Depot.Kind.RESERVE


def test_stock_is_sum_of_movements(mag, res):
    cahier = make_article("Cahier")
    record_movement(cahier, mag, Kind.PURCHASE, 50)
    record_movement(cahier, mag, Kind.SALE, -3)
    record_movement(cahier, res, Kind.PURCHASE, 20)
    record_movement(cahier, mag, Kind.CUSTOMER_RETURN, 1)
    assert on_hand(cahier, mag) == 48
    assert on_hand(cahier) == 68
    assert sum(m.quantity for m in StockMovement.objects.filter(article=cahier, depot=mag)) == 48


def test_two_offline_tills_selling_same_article_do_not_conflict(mag):
    """Deux caisses hors ligne vendent le dernier stock : leurs ventes s'additionnent, rien n'est écrasé."""
    stylo = make_article("Stylo")
    record_movement(stylo, mag, Kind.PURCHASE, 10)
    record_movement(stylo, mag, Kind.SALE, -7, movement_id=uuid.uuid4())
    record_movement(stylo, mag, Kind.SALE, -6, movement_id=uuid.uuid4())
    assert on_hand(stylo, mag) == -3  # vente hors ligne acceptée, écart visible et à corriger


def test_record_movement_is_idempotent(mag):
    stylo = make_article("Stylo")
    movement_id = uuid.uuid4()
    first = record_movement(stylo, mag, Kind.PURCHASE, 10, movement_id=movement_id)
    replay = record_movement(stylo, mag, Kind.PURCHASE, 10, movement_id=movement_id)
    assert first.pk == replay.pk
    assert on_hand(stylo, mag) == 10


def test_sign_and_immutability_rules(mag):
    stylo = make_article("Stylo")
    with pytest.raises(ValidationError):
        record_movement(stylo, mag, Kind.SALE, 5)
    with pytest.raises(ValidationError):
        record_movement(stylo, mag, Kind.PURCHASE, 0)
    movement = record_movement(stylo, mag, Kind.PURCHASE, 5)
    movement.quantity = 50
    with pytest.raises(DjangoValidationError):
        movement.save()
    with pytest.raises(DjangoValidationError):
        movement.delete()


def test_negative_stock_refused_for_manual_operations(mag):
    stylo = make_article("Stylo")
    record_movement(stylo, mag, Kind.PURCHASE, 2)
    with pytest.raises(InsufficientStock):
        adjust(stylo, mag, 5, reason="Casse")
    adjust(stylo, mag, 2, reason="Tombés dans l'eau")
    assert on_hand(stylo, mag) == 0
    with pytest.raises(ValidationError):
        adjust(stylo, mag, 1, reason="  ")


def test_lot_movements_are_converted_to_base_units(mag):
    stylo = make_article("Stylo", cost=80)
    paquet = make_article("Paquet de 10 stylos", retail=1300, type_=Article.Type.LOT, lot_base_article=stylo,
                          lot_units=10)
    movement = record_movement(paquet, mag, Kind.PURCHASE, 3, unit_cost=750)
    assert movement.article == stylo and movement.quantity == 30 and movement.unit_cost == 75
    assert on_hand(stylo, mag) == 30
    assert article_availability(paquet, stock_lookup()) == 3


def test_services_and_virtual_kits_have_no_stock(mag):
    service = make_article("Photocopie", type_=Article.Type.SERVICE)
    assert record_movement(service, mag, Kind.SALE, -1) is None
    kit = make_kit([(make_article("Cahier"), 2)])
    assert record_movement(kit.article, mag, Kind.SALE, -1) is None
    assert not StockLevel.objects.exists()


def test_reservations_affect_available_not_physical(mag):
    cahier = make_article("Cahier")
    record_movement(cahier, mag, Kind.PURCHASE, 10)
    record_movement(cahier, mag, Kind.RESERVATION, 4)
    assert on_hand(cahier, mag) == 10 and available(cahier, mag) == 6
    with pytest.raises(InsufficientStock):
        record_movement(cahier, mag, Kind.RESERVATION, 7, allow_negative=False)
    record_movement(cahier, mag, Kind.RESERVATION_RELEASE, -4)
    assert available(cahier, mag) == 10


def test_weighted_average_cost(mag):
    cahier = make_article("Cahier", cost=0)
    update_average_cost(cahier, 100, 250)
    record_movement(cahier, mag, Kind.PURCHASE, 100, unit_cost=250)
    assert cahier.avg_cost == 250
    # (100 × 250 + 50 × 310) / 150 = 270
    update_average_cost(cahier, 50, 310)
    record_movement(cahier, mag, Kind.PURCHASE, 50, unit_cost=310)
    cahier.refresh_from_db()
    assert cahier.avg_cost == 270
    assert cahier.price_history.filter(field="avg_cost", new_value="270").exists()


def test_weighted_average_cost_resets_when_stock_empty_or_negative(mag):
    cahier = make_article("Cahier", cost=200)
    record_movement(cahier, mag, Kind.SALE, -5)
    update_average_cost(cahier, 10, 260)
    assert cahier.avg_cost == 260


def test_cost_change_updates_kit_cost(mag):
    cahier = make_article("Cahier", retail=400, cost=250)
    kit = make_kit([(cahier, 6)])
    record_movement(cahier, mag, Kind.PURCHASE, 10, unit_cost=250)
    update_average_cost(cahier, 10, 350)
    kit.article.refresh_from_db()
    assert kit.article.avg_cost == 6 * 300
    assert kit.article.retail_price == 2400  # le prix de vente ne change pas


def test_stock_card_running_balance(mag):
    cahier = make_article("Cahier")
    record_movement(cahier, mag, Kind.PURCHASE, 10)
    record_movement(cahier, mag, Kind.SALE, -4)
    record_movement(cahier, mag, Kind.RESERVATION, 2)
    record_movement(cahier, mag, Kind.SALE, -1)
    assert [line.balance for line in stock_card(cahier, mag)] == [10, 6, 5]


def test_transfer_between_depots(mag, res):
    cahier = make_article("Cahier")
    record_movement(cahier, res, Kind.PURCHASE, 30)
    transfer = StockTransfer.objects.create(number="TR-TEST-1", from_depot=res, to_depot=mag)
    StockTransferLine.objects.create(transfer=transfer, article=cahier, quantity=12)
    validate_transfer(transfer)
    assert on_hand(cahier, res) == 18 and on_hand(cahier, mag) == 12 and on_hand(cahier) == 30
    with pytest.raises(ValidationError):
        validate_transfer(transfer)


def test_transfer_refuses_insufficient_stock(mag, res):
    cahier = make_article("Cahier")
    transfer = StockTransfer.objects.create(number="TR-TEST-2", from_depot=res, to_depot=mag)
    StockTransferLine.objects.create(transfer=transfer, article=cahier, quantity=1)
    with pytest.raises(InsufficientStock):
        validate_transfer(transfer)
    transfer.refresh_from_db()
    assert transfer.status == StockTransfer.Status.DRAFT
    assert not StockMovement.objects.exists()


def test_kit_assembly_and_disassembly(mag):
    cahier, stylo, regle = make_article("Cahier", cost=250), make_article("Stylo", cost=80), make_article("Règle")
    kit = make_kit([(cahier, 6), (stylo, 4), (regle, 1, True)], stock_mode=Kit.StockMode.ASSEMBLED)
    record_movement(cahier, mag, Kind.PURCHASE, 40)
    record_movement(stylo, mag, Kind.PURCHASE, 30)

    assembly = assemble_kits(kit, mag, 5, KitAssembly.Operation.ASSEMBLE)
    assert assembly.number.startswith("ASM-")
    assert on_hand(kit.article, mag) == 5
    assert on_hand(cahier, mag) == 10 and on_hand(stylo, mag) == 10
    assert on_hand(regle, mag) == 0  # facultatif : non inclus
    assert article_availability(kit.article, stock_lookup()) == 5

    with pytest.raises(InsufficientStock):
        assemble_kits(kit, mag, 2, KitAssembly.Operation.ASSEMBLE)

    assemble_kits(kit, mag, 2, KitAssembly.Operation.DISASSEMBLE)
    assert on_hand(kit.article, mag) == 3 and on_hand(cahier, mag) == 22 and on_hand(stylo, mag) == 18
    with pytest.raises(InsufficientStock):
        assemble_kits(kit, mag, 4, KitAssembly.Operation.DISASSEMBLE)


def test_virtual_kit_cannot_be_assembled(mag):
    kit = make_kit([(make_article("Cahier"), 1)])
    with pytest.raises(ValidationError):
        assemble_kits(kit, mag, 1, KitAssembly.Operation.ASSEMBLE)


def test_alerts_open_change_and_resolve(mag):
    cahier = make_article("Cahier", alert_threshold=10)
    refresh_alerts([cahier])
    assert StockAlert.objects.get(article=cahier, resolved_at__isnull=True).kind == "OUT"
    record_movement(cahier, mag, Kind.PURCHASE, 5)
    refresh_alerts([cahier])
    open_alert = StockAlert.objects.get(article=cahier, resolved_at__isnull=True)
    assert open_alert.kind == "LOW" and open_alert.available == 5
    record_movement(cahier, mag, Kind.PURCHASE, 20)
    refresh_alerts([cahier])
    assert not StockAlert.objects.filter(article=cahier, resolved_at__isnull=True).exists()
    assert StockAlert.objects.filter(article=cahier).count() == 2


def test_rebuild_levels_from_journal(mag, res):
    cahier = make_article("Cahier")
    record_movement(cahier, mag, Kind.PURCHASE, 10)
    record_movement(cahier, res, Kind.PURCHASE, 4)
    record_movement(cahier, mag, Kind.RESERVATION, 3)
    StockLevel.objects.filter(depot=mag).update(quantity=999, reserved=0)
    StockLevel.objects.filter(depot=res).delete()
    assert rebuild_stock_levels() == 2
    level = StockLevel.objects.get(article=cahier, depot=mag)
    assert (level.quantity, level.reserved) == (10, 3)
    assert StockLevel.objects.get(article=cahier, depot=res).quantity == 4
