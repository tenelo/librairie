from django.contrib import admin

from .models import CashSession, CreditNote, PaymentMethod, Sale, SaleLine, SaleReturn, Voucher


class SaleLineInline(admin.TabularInline):
    model = SaleLine
    extra = 0
    readonly_fields = ["article", "quantity", "unit_price", "discount", "line_total"]


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ["receipt_number", "sold_at", "cashier", "device", "total", "status"]
    list_filter = ["status", "channel", "device"]
    search_fields = ["receipt_number"]
    inlines = [SaleLineInline]

    def has_delete_permission(self, request, obj=None):
        return False  # aucune suppression physique d'une vente


admin.site.register(PaymentMethod)
admin.site.register(CashSession)
admin.site.register(SaleReturn)
admin.site.register(CreditNote)
admin.site.register(Voucher)
