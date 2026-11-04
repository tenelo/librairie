"""Souscriptions de démonstration (tontine scolaire), à lancer après `seed_demo`.

    python manage.py seed_demo_tontines            # 12 souscriptions (sans effet si elles existent déjà)
    python manage.py seed_demo_tontines --count 20

Chaque souscription porte un ou deux kits et parfois des articles, avec 0 à 4 versements Mobile Money
(référence « DEMO-… »). Elles se repèrent par leur note « [démo] » et sont destinées aux essais.
"""
import random

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.catalog.models import Article, Kit
from apps.sales import tontines
from apps.sales.models import Tontine

MARKER = "[démo]"
FIRST_NAMES = ["Awa", "Koffi", "Mariam", "Yao", "Aminata", "Serge", "Fatou", "Didier", "Adjoua", "Ibrahim",
               "Clarisse", "Moussa", "Estelle", "Seydou", "Bintou", "Hervé", "Nadège", "Abdoulaye", "Prisca",
               "Lassina"]
LAST_NAMES = ["Kouassi", "Traoré", "Konan", "Coulibaly", "N'Guessan", "Ouattara", "Bamba", "Yapi", "Diabaté",
              "Koné", "Soro", "Aka", "Silué", "Touré", "Gnagne"]
METHODS = ["ORANGE_MONEY", "MTN_MOMO", "WAVE", "MOOV_MONEY"]


class Command(BaseCommand):
    help = "Crée des souscriptions de tontine scolaire de démonstration (après seed_demo)."

    def add_arguments(self, parser):
        parser.add_argument("--count", type=int, default=12, help="Nombre de souscriptions à créer.")
        parser.add_argument("--seed", type=int, default=2026)

    def handle(self, *args, **options):
        if Tontine.objects.filter(notes__startswith=MARKER).exists():
            self.stdout.write("Les souscriptions de démonstration existent déjà : rien à faire.")
            return
        user = User.objects.filter(is_superuser=True, is_active=True).order_by("date_joined").first()
        kits = list(Kit.objects.filter(article__is_active=True).select_related("article"))
        articles = list(Article.objects.filter(type=Article.Type.SIMPLE, is_active=True, retail_price__gt=0))
        if user is None or not kits:
            raise CommandError("Lancez d'abord `python manage.py seed_demo` (kits et administrateur requis).")
        rng = random.Random(options["seed"])
        created = paid = 0
        with transaction.atomic():
            for index in range(max(options["count"], 1)):
                lines = [{"article": kit.article, "quantity": rng.choice([1, 1, 2])}
                         for kit in rng.sample(kits, rng.choice([1, 1, 2]))]
                if articles and rng.random() < 0.5:
                    lines += [{"article": article, "quantity": rng.randint(1, 4)}
                              for article in rng.sample(articles, rng.randint(1, 3))]
                tontine = tontines.create_tontine(user, {
                    "subscriber_name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
                    "subscriber_phone": f"07{rng.randint(10_000_000, 99_999_999)}",
                    "lines": lines,
                })
                Tontine.objects.filter(pk=tontine.pk).update(notes=f"{MARKER} souscription d'essai")
                created += 1
                # Avancement varié : rien versé, partiel, presque soldé ou soldé.
                share = rng.choice([0, 0.25, 0.5, 0.75, 1])
                to_pay = tontine.target_amount if share == 1 else int(tontine.target_amount * share) // 5 * 5
                count = rng.randint(1, 4) if to_pay else 0
                part = to_pay // count // 5 * 5 if count else 0
                for number in range(count):
                    amount = to_pay - part * (count - 1) if number == count - 1 else part
                    if amount <= 0:
                        continue
                    tontines.record_payment(user, tontine.pk, {
                        "amount": amount, "method": rng.choice(METHODS),
                        "reference": f"DEMO-{index + 1:02d}{number + 1}",
                    })
                    paid += 1
        self.stdout.write(self.style.SUCCESS(
            f"{created} souscriptions de démonstration créées, {paid} versements Mobile Money."))
