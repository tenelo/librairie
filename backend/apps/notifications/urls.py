from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AuthorizationRequestView,
    EventCatalogView,
    NotificationViewSet,
    PreferencesView,
    PushSubscriptionView,
    TestNotificationView,
)

router = DefaultRouter()
router.register("", NotificationViewSet, basename="notification")

urlpatterns = [
    path("preferences/", PreferencesView.as_view(), name="notification-preferences"),
    path("push/", PushSubscriptionView.as_view(), name="notification-push"),
    path("test/", TestNotificationView.as_view(), name="notification-test"),
    path("authorization-request/", AuthorizationRequestView.as_view(), name="notification-authorization"),
    path("events/", EventCatalogView.as_view(), name="notification-events"),
    *router.urls,
]
