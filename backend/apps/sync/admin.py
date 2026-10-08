from django.contrib import admin

from .models import SyncConflict, SyncOperation


@admin.register(SyncOperation)
class SyncOperationAdmin(admin.ModelAdmin):
    list_display = ["received_at", "entity", "operation", "status", "device", "user"]
    list_filter = ["status", "entity"]


admin.site.register(SyncConflict)
