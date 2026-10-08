from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ArticleImportView,
    ArticleViewSet,
    BrandViewSet,
    CategoryViewSet,
    KitImportView,
    KitViewSet,
    SchoolLevelViewSet,
    SchoolYearViewSet,
    TemplateView,
    UnitViewSet,
)

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("brands", BrandViewSet, basename="brand")
router.register("units", UnitViewSet, basename="unit")
router.register("articles", ArticleViewSet, basename="article")
router.register("levels", SchoolLevelViewSet, basename="school-level")
router.register("school-years", SchoolYearViewSet, basename="school-year")
router.register("kits", KitViewSet, basename="kit")

urlpatterns = [
    path("import/articles/", ArticleImportView.as_view(), name="import-articles"),
    path("import/kits/", KitImportView.as_view(), name="import-kits"),
    path("templates/<str:kind>/", TemplateView.as_view(), name="catalog-template"),
    *router.urls,
]
