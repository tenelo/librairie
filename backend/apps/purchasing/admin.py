from django.contrib import admin

from .models import GoodsReceipt, PurchaseOrder, PurchaseOrderLine, Supplier, SupplierArticle


class PurchaseOrderLineInline(admin.TabularInline):
    model = PurchaseOrderLine
    extra = 0


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ["number", "supplier", "depot", "status", "order_date", "expected_date"]
    list_filter = ["status", "supplier"]
    inlines = [PurchaseOrderLineInline]


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ["name", "contact_name", "phone", "lead_time_days", "is_active"]
    search_fields = ["name"]


admin.site.register(SupplierArticle)
admin.site.register(GoodsReceipt)
