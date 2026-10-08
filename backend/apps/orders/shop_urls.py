"""API publique et client de la boutique en ligne : `/api/shop/`."""
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    PaymentWebhookView,
    SandboxPaymentView,
    ShopArticleViewSet,
    ShopKitViewSet,
    ShopOrderViewSet,
    ShopReferenceView,
)

router = DefaultRouter()
router.register("articles", ShopArticleViewSet, basename="shop-article")
router.register("kits", ShopKitViewSet, basename="shop-kit")
router.register("orders", ShopOrderViewSet, basename="shop-order")

urlpatterns = [
    path("reference/", ShopReferenceView.as_view(), name="shop-reference"),
    path("payments/<str:reference>/simulate/", SandboxPaymentView.as_view(), name="shop-payment-simulate"),
    path("payments/webhook/<str:provider>/", PaymentWebhookView.as_view(), name="shop-payment-webhook"),
    *router.urls,
]
