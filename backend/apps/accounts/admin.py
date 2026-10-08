from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Device, Permission, Role, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["username", "first_name", "last_name", "phone", "role", "is_active", "last_login"]
    list_filter = ["role", "is_active", "is_superuser"]
    search_fields = ["username", "first_name", "last_name", "phone", "email"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Librairie", {"fields": ("phone", "role", "offline_max_hours", "must_change_password")}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (("Librairie", {"fields": ("phone", "role")}),)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ["code", "label", "is_staff_role", "max_discount_percent"]
    filter_horizontal = ["permissions"]


@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ["code", "label", "module"]
    list_filter = ["module"]


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "kind", "is_active", "last_seen_at", "last_sync_at"]
    list_filter = ["kind", "is_active"]
