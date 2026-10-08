from django.contrib import admin

from .models import Depot, KitAssembly, Location, StockAlert, StockLevel, StockMovement, StockTransfer


@admin.register(Depot)
class DepotAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "kind", "is_pickup_point", "is_default", "is_active"]


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ["occurred_at", "kind", "article", "depot", "quantity", "unit_cost", "reference", "user"]
    list_filter = ["kind", "depot"]
    search_fields = ["article__name", "article__code", "reference"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(StockLevel)
class StockLevelAdmin(admin.ModelAdmin):
    list_display = ["article", "depot", "quantity", "reserved", "location"]
    list_filter = ["depot"]
    readonly_fields = ["quantity", "reserved"]


admin.site.register(Location)
admin.site.register(StockAlert)
admin.site.register(StockTransfer)
admin.site.register(KitAssembly)
