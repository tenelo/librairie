from rest_framework.routers import DefaultRouter

from .views import InventorySessionViewSet

router = DefaultRouter()
router.register("sessions", InventorySessionViewSet, basename="inventory-session")

urlpatterns = router.urls
