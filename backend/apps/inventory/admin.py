from django.contrib import admin

from .models import InventoryCount, InventorySession


@admin.register(InventorySession)
class InventorySessionAdmin(admin.ModelAdmin):
    list_display = ["number", "name", "kind", "status", "depot", "frozen_at", "validated_at"]
    list_filter = ["status", "kind"]


admin.site.register(InventoryCount)
