"""Point d'entrée ASGI : HTTP (Django) et WebSocket (Channels, authentifié par JWT)."""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

# L'application Django doit être initialisée avant d'importer du code qui touche aux modèles.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from apps.core.routing import websocket_urlpatterns  # noqa: E402
from apps.core.ws_auth import JwtAuthMiddleware  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AllowedHostsOriginValidator(JwtAuthMiddleware(URLRouter(websocket_urlpatterns))),
    }
)
