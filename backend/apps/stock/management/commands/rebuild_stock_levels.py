from django.core.management.base import BaseCommand

from apps.stock.services import rebuild_stock_levels


class Command(BaseCommand):
    help = "Reconstruit les niveaux de stock à partir du journal des mouvements (contrôle de cohérence)."

    def handle(self, *args, **options):
        changed = rebuild_stock_levels()
        self.stdout.write(self.style.SUCCESS(f"{changed} niveau(x) corrigé(s)."))
