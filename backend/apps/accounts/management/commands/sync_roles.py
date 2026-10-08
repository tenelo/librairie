from django.core.management.base import BaseCommand

from apps.accounts.catalog import sync_permissions_and_roles
from apps.accounts.models import Permission, Role


class Command(BaseCommand):
    help = "Crée les permissions et rôles manquants (--reset rétablit la matrice par défaut)."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Rétablit la matrice par défaut de tous les rôles.")

    def handle(self, *args, **options):
        sync_permissions_and_roles(Permission, Role, reset=options["reset"])
        self.stdout.write(self.style.SUCCESS(f"{Permission.objects.count()} permissions, {Role.objects.count()} rôles."))
