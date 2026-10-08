from django.contrib import admin

from .models import Notification, NotificationPreference, PushSubscription


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["title", "recipient", "event", "created_at", "read_at"]
    list_filter = ["event"]
    search_fields = ["title", "recipient__username"]


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ["user", "event", "in_app", "push", "email", "sms"]


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "app", "created_at", "last_success_at"]
