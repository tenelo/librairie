"""Crée le compte administrateur initial à partir des variables d'environnement (idempotent)."""
import os

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.catalog import ADMIN
from apps.accounts.models import Role, User


class Command(BaseCommand):
    help = "Crée l'administrateur initial (ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL) s'il n'existe pas."

    def add_arguments(self, parser):
        parser.add_argument("--username", default=os.environ.get("ADMIN_USERNAME", "admin"))
        parser.add_argument("--password", default=os.environ.get("ADMIN_PASSWORD"))
        parser.add_argument("--email", default=os.environ.get("ADMIN_EMAIL", ""))

    def handle(self, *args, **options):
        username = options["username"]
        if User.objects.filter(username__iexact=username).exists():
            self.stdout.write(f"L'utilisateur « {username} » existe déjà.")
            return
        password = options["password"]
        if not password:
            raise CommandError("Mot de passe requis : --password ou variable ADMIN_PASSWORD.")
        user = User(
            username=username,
            email=options["email"],
            first_name="Administrateur",
            role=Role.objects.get(code=ADMIN),
            is_staff=True,
            is_superuser=True,
        )
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(f"Administrateur « {username} » créé."))
