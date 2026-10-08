from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["server_timestamp", "action", "entity", "username", "role_code", "device", "origin"]
    list_filter = ["action", "origin", "role_code"]
    search_fields = ["username", "entity", "entity_id", "description"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
