from django.contrib import admin

from .models import School


@admin.register(School)
class SchoolAdmin(admin.ModelAdmin):
    list_display = ["name", "city", "district", "phone", "is_active"]
    list_filter = ["city", "is_active"]
    search_fields = ["name", "city"]
