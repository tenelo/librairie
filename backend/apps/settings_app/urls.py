from django.urls import path

from .views import LibrarySettingsView, PublicLibrarySettingsView

urlpatterns = [
    path("library/", LibrarySettingsView.as_view(), name="library-settings"),
    path("public/", PublicLibrarySettingsView.as_view(), name="library-settings-public"),
]
