from django.urls import path

from .views import (
    ChangePasswordView,
    LoginView,
    LogoutView,
    MeView,
    RefreshView,
    RegisterView,
    SetPinView,
    VerifyPinView,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth-login"),
    path("refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("me/password/", ChangePasswordView.as_view(), name="auth-change-password"),
    path("me/pin/", SetPinView.as_view(), name="auth-set-pin"),
    path("pin/verify/", VerifyPinView.as_view(), name="auth-verify-pin"),
]
