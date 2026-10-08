from rest_framework.routers import DefaultRouter

from .views import CustomerViewSet, SchoolViewSet

router = DefaultRouter()
router.register("schools", SchoolViewSet, basename="school")
router.register("customers", CustomerViewSet, basename="customer")

urlpatterns = router.urls
