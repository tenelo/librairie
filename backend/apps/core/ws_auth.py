"""Authentification JWT des connexions WebSocket.

Les navigateurs ne permettent pas d'envoyer un en-tête Authorization lors de l'ouverture
d'un WebSocket : le jeton d'accès est donc transmis dans la query string (`?token=...`).
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def get_user_from_token(raw_token):
    try:
        token = AccessToken(raw_token)
    except TokenError:
        return AnonymousUser()
    user_model = get_user_model()
    try:
        return user_model.objects.get(id=token["user_id"], is_active=True)
    except (user_model.DoesNotExist, KeyError, ValueError):
        return AnonymousUser()


class JwtAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        params = parse_qs(scope.get("query_string", b"").decode())
        token = (params.get("token") or [None])[0]
        scope = dict(scope)
        scope["user"] = await get_user_from_token(token) if token else AnonymousUser()
        return await self.inner(scope, receive, send)
