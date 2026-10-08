from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DepotViewSet,
    KitAssemblyViewSet,
    LocationViewSet,
    StockAlertViewSet,
    StockLevelViewSet,
    StockMovementViewSet,
    StockStateView,
    StockSummaryView,
    StockTransferViewSet,
)

router = DefaultRouter()
router.register("depots", DepotViewSet, basename="depot")
router.register("locations", LocationViewSet, basename="location")
router.register("levels", StockLevelViewSet, basename="stock-level")
router.register("movements", StockMovementViewSet, basename="stock-movement")
router.register("transfers", StockTransferViewSet, basename="stock-transfer")
router.register("assemblies", KitAssemblyViewSet, basename="kit-assembly")
router.register("alerts", StockAlertViewSet, basename="stock-alert")

urlpatterns = [
    path("state/", StockStateView.as_view(), name="stock-state"),
    path("summary/", StockSummaryView.as_view(), name="stock-summary"),
    *router.urls,
]
