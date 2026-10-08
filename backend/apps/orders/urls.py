from rest_framework.routers import DefaultRouter

from .views import OnlineOrderViewSet

router = DefaultRouter()
router.register("orders", OnlineOrderViewSet, basename="online-order")

urlpatterns = router.urls
