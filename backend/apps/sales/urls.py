from rest_framework.routers import DefaultRouter

from .views import (
    CashSessionViewSet,
    CreditNoteViewSet,
    PaymentMethodViewSet,
    SaleReturnViewSet,
    SaleViewSet,
    VoucherViewSet,
)

router = DefaultRouter()
router.register("payment-methods", PaymentMethodViewSet, basename="payment-method")
router.register("sales", SaleViewSet, basename="sale")
router.register("sessions", CashSessionViewSet, basename="cash-session")
router.register("returns", SaleReturnViewSet, basename="sale-return")
router.register("credit-notes", CreditNoteViewSet, basename="credit-note")
router.register("vouchers", VoucherViewSet, basename="voucher")

urlpatterns = router.urls
