"""Génère une paire de clés VAPID pour le Web Push, au format attendu par les variables d'environnement."""
import base64

from cryptography.hazmat.primitives import serialization
from django.core.management.base import BaseCommand
from py_vapid import Vapid01


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class Command(BaseCommand):
    help = "Génère VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY (à copier dans backend/.env)."

    def handle(self, *args, **options):
        vapid = Vapid01()
        vapid.generate_keys()
        public = vapid.public_key.public_bytes(serialization.Encoding.X962,
                                               serialization.PublicFormat.UncompressedPoint)
        private = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
        self.stdout.write(f"VAPID_PUBLIC_KEY={b64url(public)}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={b64url(private)}")
