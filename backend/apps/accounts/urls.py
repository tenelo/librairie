from rest_framework.routers import DefaultRouter

from .views import DeviceViewSet, PermissionViewSet, RoleViewSet, UserViewSet

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("roles", RoleViewSet, basename="role")
router.register("permissions", PermissionViewSet, basename="permission")
router.register("devices", DeviceViewSet, basename="device")

urlpatterns = router.urls
