from django.contrib import admin

from .models import Article, Barcode, Brand, Category, Kit, KitComponent, PriceHistory, SchoolLevel, SchoolYear, Unit


class BarcodeInline(admin.TabularInline):
    model = Barcode
    extra = 0
    fields = ["code", "kind", "is_deleted"]


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "type", "category", "retail_price", "avg_cost", "is_active", "is_online"]
    list_filter = ["type", "is_active", "is_online", "category"]
    search_fields = ["code", "name", "barcodes__code"]
    inlines = [BarcodeInline]


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "parent", "sort_order", "is_active"]


class KitComponentInline(admin.TabularInline):
    model = KitComponent
    extra = 0
    fields = ["article", "quantity", "is_optional", "sort_order"]
    autocomplete_fields = ["article"]


@admin.register(Kit)
class KitAdmin(admin.ModelAdmin):
    list_display = ["article", "level", "school", "school_year", "pricing_mode", "stock_mode"]
    list_filter = ["level", "school_year", "stock_mode"]
    inlines = [KitComponentInline]


admin.site.register(Brand)
admin.site.register(Unit)
admin.site.register(SchoolLevel)
admin.site.register(SchoolYear)


@admin.register(PriceHistory)
class PriceHistoryAdmin(admin.ModelAdmin):
    list_display = ["article", "field", "old_value", "new_value", "changed_by", "changed_at"]

    def has_change_permission(self, request, obj=None):
        return False
