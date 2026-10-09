from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DashboardView, ReportView, ScheduledReportViewSet

router = DefaultRouter()
router.register("scheduled", ScheduledReportViewSet, basename="scheduled-report")

urlpatterns = [
    path("dashboard/", DashboardView.as_view(), name="report-dashboard"),
    *router.urls,
    path("<str:name>/", ReportView.as_view(), name="report"),
]
