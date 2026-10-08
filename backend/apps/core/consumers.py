"""Canal WebSocket de présence : chaque utilisateur authentifié rejoint son groupe personnel.

Ce groupe `user_<id>` est celui qu'utilisera l'application `notifications` pour pousser
les notifications temps réel.
"""
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone


def user_group(user_id) -> str:
    return f"user_{str(user_id).replace('-', '')}"


class StatusConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4401)
            return
        self.group_name = user_group(user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send_json({"type": "welcome", "server_time": timezone.now().isoformat()})

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if content.get("type") == "ping":
            await self.send_json({"type": "pong", "server_time": timezone.now().isoformat()})

    async def push_message(self, event):
        """Relaie un message envoyé au groupe de l'utilisateur via `channel_layer.group_send`."""
        await self.send_json(event["payload"])
