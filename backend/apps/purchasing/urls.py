from rest_framework.routers import DefaultRouter

from .views import GoodsReceiptViewSet, PurchaseOrderViewSet, SuggestionViewSet, SupplierViewSet

router = DefaultRouter()
router.register("suppliers", SupplierViewSet, basename="supplier")
router.register("orders", PurchaseOrderViewSet, basename="purchase-order")
router.register("receipts", GoodsReceiptViewSet, basename="goods-receipt")
router.register("suggestions", SuggestionViewSet, basename="reorder-suggestion")

urlpatterns = router.urls
