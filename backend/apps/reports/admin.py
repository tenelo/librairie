from django.contrib import admin

from .models import ScheduledReport


@admin.register(ScheduledReport)
class ScheduledReportAdmin(admin.ModelAdmin):
    list_display = ["name", "report", "frequency", "is_active", "last_sent_at"]
