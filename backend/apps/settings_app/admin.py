from django.contrib import admin

from .models import LibrarySettings


@admin.register(LibrarySettings)
class LibrarySettingsAdmin(admin.ModelAdmin):
    list_display = ["name", "city", "phone", "offline_max_hours", "updated_at"]

    def has_add_permission(self, request):
        return not LibrarySettings.all_objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
