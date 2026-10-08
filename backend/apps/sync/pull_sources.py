"""Données descendues vers les terminaux (catalogue, kits, stocks, référentiels, paramètres).

Format compact (dict plats) : le terminal les range tels quels dans ses tables IndexedDB.
Chaque ligne porte `id`, `sync_version` et `is_deleted`.
"""
from apps.catalog.models import (
    Article,
    Barcode,
    Brand,
    Category,
    Kit,
    KitComponent,
    SchoolLevel,
    SchoolYear,
    Unit,
)
from apps.customers.models import School
from apps.purchasing.models import PurchaseOrder, Supplier
from apps.settings_app.models import LibrarySettings
from apps.stock.models import Depot, StockLevel

from .registry import register_pull


def base(obj):
    return {"id": str(obj.pk), "sync_version": obj.sync_version, "is_deleted": obj.is_deleted}


def article(obj: Article):
    return {**base(obj), "code": obj.code, "name": obj.name, "type": obj.type,
            "category": str(obj.category_id) if obj.category_id else None,
            "brand": str(obj.brand_id) if obj.brand_id else None, "unit": str(obj.unit_id) if obj.unit_id else None,
            "avg_cost": obj.avg_cost, "retail_price": obj.retail_price, "wholesale_price": obj.wholesale_price,
            "wholesale_min_qty": obj.wholesale_min_qty, "vat_rate": obj.vat_rate, "vat_exempt": obj.vat_exempt,
            "alert_threshold": obj.alert_threshold, "is_active": obj.is_active, "is_online": obj.is_online,
            "lot_base_article": str(obj.lot_base_article_id) if obj.lot_base_article_id else None,
            "lot_units": obj.lot_units}


def kit(obj: Kit):
    return {**base(obj), "article": str(obj.article_id), "level": str(obj.level_id),
            "school": str(obj.school_id) if obj.school_id else None,
            "school_year": str(obj.school_year_id) if obj.school_year_id else None,
            "pricing_mode": obj.pricing_mode, "discount_percent": obj.discount_percent, "stock_mode": obj.stock_mode}


def kit_component(obj: KitComponent):
    return {**base(obj), "kit": str(obj.kit_id), "article": str(obj.article_id), "quantity": obj.quantity,
            "is_optional": obj.is_optional, "sort_order": obj.sort_order,
            "substitutes": [str(pk) for pk in obj.substitutes.values_list("pk", flat=True)]}


def purchase_order(obj: PurchaseOrder):
    """Seuls les bons en attente de livraison restent sur les terminaux (réception hors ligne) :
    les autres sont transmis comme supprimés pour être retirés de la base locale."""
    open_order = obj.status in PurchaseOrder.OPEN_STATUSES and not obj.is_deleted
    return {**base(obj), "is_deleted": not open_order, "number": obj.number, "supplier": str(obj.supplier_id),
            "depot": str(obj.depot_id), "status": obj.status,
            "lines": [{"id": str(line.pk), "article": str(line.article_id), "article_code": line.article.code,
                       "article_name": line.article.name, "quantity": line.quantity, "unit_cost": line.unit_cost,
                       "received_quantity": line.received_quantity, "remaining": line.remaining}
                      for line in obj.lines.all()] if open_order else []}


def register_core_sources():
    register_pull("articles", lambda: Article.all_objects.all(), article, "catalog.view")
    register_pull("barcodes", lambda: Barcode.all_objects.all(),
                  lambda o: {**base(o), "article": str(o.article_id), "code": o.code, "kind": o.kind}, "catalog.view")
    register_pull("categories", lambda: Category.all_objects.all(),
                  lambda o: {**base(o), "name": o.name, "parent": str(o.parent_id) if o.parent_id else None,
                             "sort_order": o.sort_order, "is_active": o.is_active}, "catalog.view")
    register_pull("brands", lambda: Brand.all_objects.all(), lambda o: {**base(o), "name": o.name}, "catalog.view")
    register_pull("units", lambda: Unit.all_objects.all(),
                  lambda o: {**base(o), "code": o.code, "label": o.label}, "catalog.view")
    register_pull("kits", lambda: Kit.all_objects.all(), kit, "catalog.view")
    register_pull("kit_components", lambda: KitComponent.all_objects.prefetch_related("substitutes"), kit_component,
                  "catalog.view")
    register_pull("levels", lambda: SchoolLevel.all_objects.all(),
                  lambda o: {**base(o), "code": o.code, "label": o.label, "cycle": o.cycle, "series": o.series,
                             "sort_order": o.sort_order, "is_active": o.is_active})
    register_pull("school_years", lambda: SchoolYear.all_objects.all(),
                  lambda o: {**base(o), "label": o.label, "is_current": o.is_current})
    register_pull("schools", lambda: School.all_objects.all(),
                  lambda o: {**base(o), "name": o.name, "city": o.city, "is_active": o.is_active})
    register_pull("depots", lambda: Depot.all_objects.all(),
                  lambda o: {**base(o), "code": o.code, "name": o.name, "kind": o.kind, "is_default": o.is_default,
                             "is_pickup_point": o.is_pickup_point, "is_active": o.is_active})
    register_pull("stock_levels", lambda: StockLevel.all_objects.all(),
                  lambda o: {**base(o), "article": str(o.article_id), "depot": str(o.depot_id),
                             "quantity": o.quantity, "reserved": o.reserved}, "stock.view")
    register_pull("suppliers", lambda: Supplier.all_objects.all(),
                  lambda o: {**base(o), "name": o.name, "phone": o.phone, "is_active": o.is_active},
                  "purchasing.view")
    register_pull("purchase_orders", lambda: PurchaseOrder.all_objects.prefetch_related("lines__article"),
                  purchase_order, "purchasing.receive")
    register_pull("settings", lambda: LibrarySettings.all_objects.all(),
                  lambda o: {**base(o), "name": o.name, "logo": o.logo.url if o.logo else None, "address": o.address,
                             "city": o.city, "phone": o.phone, "email": o.email, "website": o.website,
                             "taxpayer_number": o.taxpayer_number, "trade_register": o.trade_register,
                             "receipt_header": o.receipt_header, "receipt_footer": o.receipt_footer,
                             "vat_enabled": o.vat_enabled, "default_vat_rate": o.default_vat_rate,
                             "offline_max_hours": o.offline_max_hours,
                             "sync_interval_minutes": o.sync_interval_minutes, "price_rounding": o.price_rounding,
                             "loyalty_points_per_1000": o.loyalty_points_per_1000})
