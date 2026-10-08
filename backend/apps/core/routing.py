from django.urls import path

from .consumers import StatusConsumer

websocket_urlpatterns = [
    path("ws/status/", StatusConsumer.as_asgi()),
]
