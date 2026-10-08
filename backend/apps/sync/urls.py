from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import PullView, PushView, SyncConflictViewSet, SyncOperationViewSet, SyncStateView

router = DefaultRouter()
router.register("operations", SyncOperationViewSet, basename="sync-operation")
router.register("conflicts", SyncConflictViewSet, basename="sync-conflict")

urlpatterns = [
    path("push/", PushView.as_view(), name="sync-push"),
    path("pull/", PullView.as_view(), name="sync-pull"),
    path("state/", SyncStateView.as_view(), name="sync-state"),
    *router.urls,
]
