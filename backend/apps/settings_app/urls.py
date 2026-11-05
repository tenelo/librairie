from django.urls import path

from .codes import CodeSettingDetailView, CodeSettingsView
from .views import LibrarySettingsView, PublicLibrarySettingsView

urlpatterns = [
    path("library/", LibrarySettingsView.as_view(), name="library-settings"),
    path("public/", PublicLibrarySettingsView.as_view(), name="library-settings-public"),
    path("codes/", CodeSettingsView.as_view(), name="code-settings"),
    path("codes/<str:key>/", CodeSettingDetailView.as_view(), name="code-setting-detail"),
]
