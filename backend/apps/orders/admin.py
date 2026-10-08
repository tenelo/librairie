from django.contrib import admin

from .models import OnlineOrder, OnlineOrderLine, OrderStatusHistory, PaymentTransaction


class LineInline(admin.TabularInline):
    model = OnlineOrderLine
    extra = 0
    fields = ["article", "ordered_qty", "quantity", "unit_price", "line_total", "prepared_qty", "status"]
    readonly_fields = fields


class HistoryInline(admin.TabularInline):
    model = OrderStatusHistory
    extra = 0
    readonly_fields = ["from_status", "to_status", "note", "user", "at"]


@admin.register(OnlineOrder)
class OnlineOrderAdmin(admin.ModelAdmin):
    list_display = ["number", "customer", "status", "total", "pickup_depot", "created_at"]
    list_filter = ["status", "pickup_depot"]
    search_fields = ["number", "customer__name", "customer__phone"]
    inlines = [LineInline, HistoryInline]
    readonly_fields = ["number", "status", "total", "deposit_paid", "sale"]


@admin.register(PaymentTransaction)
class PaymentTransactionAdmin(admin.ModelAdmin):
    list_display = ["external_ref", "order", "provider", "amount", "status", "created_at"]
    list_filter = ["status", "provider"]
