"""Données de démonstration : librairie ivoirienne réaliste (catalogue, kits, stock, clients, 3 mois de ventes).

    python manage.py seed_demo            # crée les données (sans effet si elles existent déjà)
    python manage.py seed_demo --days 30  # historique de ventes plus court (plus rapide)

Les comptes de démonstration (un par rôle) partagent le mot de passe `Demo-Librairie-2026` et le PIN
`2026` ; ils sont destinés aux tests et doivent être supprimés ou modifiés avant une mise en service.
"""
import random
import uuid
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.catalog import (
    CAISSIER,
    CLIENT,
    GERANT,
    INVENTORISTE,
    MAGASINIER,
    PREPARATEUR,
)
from apps.accounts.models import Device, Role, User
from apps.catalog.models import (
    Article,
    Brand,
    Category,
    Kit,
    KitComponent,
    PriceHistory,
    SchoolLevel,
    SchoolYear,
    Unit,
)
from apps.catalog.services import add_internal_barcode, next_article_code, refresh_kit_price
from apps.customers.models import Customer, School
from apps.orders import services as orders
from apps.orders.models import OnlineOrder
from apps.purchasing.models import Supplier
from apps.purchasing.services import receive_goods
from apps.sales import services as sales
from apps.sales.models import Sale
from apps.stock.models import Depot, Location
from apps.stock.services import refresh_all_alerts
from apps.sync.registry import SyncContext

PASSWORD = "Demo-Librairie-2026"
PIN = "2026"
MARKER = "[démo]"

# (catégorie, sous-catégorie) → [(désignation, prix de vente, coût, marque, seuil d'alerte)]
CATALOG = {
    ("Cahiers", "Petits cahiers"): [
        ("Cahier 32 pages petit format seyès", 100, 60, "Sélecta", 50),
        ("Cahier 48 pages petit format seyès", 150, 90, "Sélecta", 50),
        ("Cahier 96 pages petit format seyès", 250, 160, "Sélecta", 40),
        ("Cahier 100 pages petit format grands carreaux", 300, 190, "Clairefontaine", 40),
        ("Cahier 192 pages petit format", 450, 290, "Sélecta", 30),
        ("Cahier de brouillon 96 pages", 200, 120, "Sélecta", 40),
        ("Cahier de poésie 48 pages", 300, 180, "Clairefontaine", 15),
        ("Cahier de musique 32 pages", 350, 210, "Clairefontaine", 10),
    ],
    ("Cahiers", "Grands cahiers"): [
        ("Cahier 100 pages grand format 24x32", 500, 320, "Clairefontaine", 30),
        ("Cahier 200 pages grand format 24x32", 900, 580, "Clairefontaine", 25),
        ("Cahier 288 pages grand format", 1300, 850, "Sélecta", 20),
        ("Cahier 300 pages grand format", 1400, 900, "Sélecta", 20),
        ("Cahier de travaux pratiques 48 pages", 500, 300, "Clairefontaine", 20),
        ("Cahier de dessin 32 pages", 600, 380, "Clairefontaine", 15),
        ("Cahier de textes", 700, 420, "Clairefontaine", 15),
        ("Cahier d'activités CP1", 1500, 950, "Sélecta", 10),
        ("Cahier d'activités CE1", 1500, 950, "Sélecta", 10),
        ("Cahier d'activités CM1", 1700, 1050, "Sélecta", 10),
    ],
    ("Écriture", "Stylos"): [
        ("Stylo à bille bleu", 150, 80, "Bic", 100),
        ("Stylo à bille rouge", 150, 80, "Bic", 60),
        ("Stylo à bille noir", 150, 80, "Bic", 60),
        ("Stylo à bille vert", 150, 80, "Bic", 40),
        ("Stylo 4 couleurs", 750, 450, "Bic", 20),
        ("Stylo plume avec cartouches", 2500, 1500, "Maped", 10),
        ("Boîte de cartouches d'encre bleue (6)", 600, 350, "Maped", 15),
        ("Effaceur réécriveur", 500, 300, "Maped", 20),
        ("Stylo gel noir", 400, 240, "Maped", 20),
        ("Lot de 10 stylos à bille bleus", 1300, 750, "Bic", 15),
    ],
    ("Écriture", "Crayons et feutres"): [
        ("Crayon à papier HB", 100, 50, "Maped", 80),
        ("Crayon à papier 2B", 125, 65, "Maped", 30),
        ("Boîte de 12 crayons de couleur", 1200, 700, "Maped", 20),
        ("Boîte de 24 crayons de couleur", 2200, 1300, "Maped", 10),
        ("Pochette de 12 feutres", 1500, 900, "Maped", 15),
        ("Surligneur jaune", 400, 230, "Maped", 25),
        ("Lot de 4 surligneurs", 1500, 900, "Maped", 10),
        ("Boîte de craies blanches (100)", 2000, 1200, "Sélecta", 10),
        ("Boîte de craies de couleur (100)", 2500, 1500, "Sélecta", 10),
        ("Taille-crayon avec réservoir", 300, 160, "Maped", 40),
        ("Gomme blanche", 100, 50, "Maped", 80),
        ("Feutre ardoise effaçable", 400, 230, "Maped", 30),
    ],
    ("Fournitures de bureau", "Géométrie"): [
        ("Règle plate 20 cm", 200, 110, "Maped", 40),
        ("Règle plate 30 cm", 300, 160, "Maped", 40),
        ("Équerre 21 cm", 400, 220, "Maped", 30),
        ("Rapporteur 180°", 300, 160, "Maped", 30),
        ("Compas simple", 1000, 600, "Maped", 20),
        ("Compas métal à bague", 2500, 1500, "Maped", 10),
        ("Kit de géométrie 4 pièces", 1200, 700, "Maped", 20),
        ("Calculatrice de base", 3500, 2200, "Casio", 10),
        ("Calculatrice scientifique", 12000, 8000, "Casio", 5),
    ],
    ("Fournitures de bureau", "Classement et papier"): [
        ("Protège-cahier petit format", 150, 80, "Sélecta", 60),
        ("Protège-cahier grand format", 250, 140, "Sélecta", 40),
        ("Rouleau de papier kraft", 500, 280, "Sélecta", 15),
        ("Rame de papier A4 80 g (500 feuilles)", 4000, 2900, "Double A", 10),
        ("Paquet de copies doubles grand format (100)", 2000, 1300, "Clairefontaine", 15),
        ("Paquet de copies simples (100)", 1200, 750, "Clairefontaine", 15),
        ("Chemise cartonnée", 150, 80, "Sélecta", 40),
        ("Classeur à levier A4", 2000, 1250, "Sélecta", 10),
        ("Paquet d'étiquettes scolaires", 300, 150, "Sélecta", 30),
        ("Agenda scolaire", 2000, 1200, "Sélecta", 15),
        ("Tube de colle liquide", 300, 160, "UHU", 30),
        ("Bâton de colle 21 g", 500, 280, "UHU", 30),
        ("Paire de ciseaux à bouts ronds", 500, 280, "Maped", 25),
        ("Rouleau de ruban adhésif", 300, 160, "Sélecta", 20),
        ("Agrafeuse de bureau", 3000, 1900, "Maped", 5),
    ],
    ("Papeterie", "Ardoises et art"): [
        ("Ardoise blanche effaçable", 800, 480, "Maped", 25),
        ("Ardoise noire cadre bois", 700, 420, "Sélecta", 25),
        ("Chiffon pour ardoise", 150, 70, "Sélecta", 30),
        ("Boîte de pâte à modeler", 1000, 600, "Maped", 15),
        ("Boîte de peinture gouache (10 tubes)", 3000, 1900, "Maped", 8),
        ("Pinceaux (lot de 3)", 800, 450, "Maped", 10),
        ("Bloc de dessin A4", 1000, 600, "Clairefontaine", 15),
        ("Papier calque (pochette)", 700, 400, "Clairefontaine", 10),
    ],
    ("Sacs et trousses", ""): [
        ("Trousse simple", 1000, 600, "Maped", 20),
        ("Trousse double compartiment", 2500, 1500, "Maped", 10),
        ("Cartable primaire", 7500, 4800, "Maped", 5),
        ("Sac à dos collège", 10000, 6500, "Maped", 5),
        ("Gourde 50 cl", 2000, 1200, "Maped", 10),
        ("Boîte à goûter", 1500, 900, "Maped", 10),
    ],
}

SUBJECTS = {
    "PRIMAIRE": ["Lecture", "Mathématiques", "Éveil au milieu", "Écriture"],
    "COLLEGE": ["Français", "Mathématiques", "Anglais", "Histoire-Géographie", "SVT"],
    "LYCEE": ["Français", "Mathématiques", "Physique-Chimie", "Philosophie"],
}
BOOK_PRICES = {"PRIMAIRE": (2800, 1900), "COLLEGE": (4500, 3100), "LYCEE": (5500, 3900)}
SERVICES = [("Photocopie noir et blanc (page)", 25), ("Impression couleur (page)", 150), ("Reliure spirale", 1000),
            ("Plastification A4", 500), ("Couverture de livres (par livre)", 300)]

SCHOOLS = [
    ("Groupe scolaire Les Flamboyants", "Abidjan", "Cocody Angré", "27 22 50 10 10"),
    ("Collège privé La Lagune", "Abidjan", "Marcory Zone 4", "27 21 26 20 20"),
    ("Institution Akwaba", "Abidjan", "Yopougon Selmer", "27 23 45 30 30"),
]
SUPPLIERS = [
    ("Papeteries Réunies d'Abidjan", "M. Konan", "27 21 35 40 40", 5),
    ("Ivoire Fournitures Scolaires", "Mme Bamba", "27 22 44 55 66", 7),
    ("Éditions du Golfe (distribution)", "M. Yao", "27 20 30 10 10", 14),
    ("Import Bureau Plus", "Mme Diabaté", "27 21 75 80 90", 21),
]
FIRST_NAMES = ["Aminata", "Koffi", "Awa", "Yao", "Fatou", "Kouassi", "Mariam", "Ibrahim", "Adjoua", "Sékou", "Aya",
               "Moussa", "Affoué", "Jean-Marc", "Salimata", "Didier", "Akissi", "Ousmane", "Christelle", "Brice"]
LAST_NAMES = ["Koné", "Traoré", "Kouamé", "Ouattara", "Diallo", "N'Guessan", "Bamba", "Coulibaly", "Yao", "Touré",
              "Kouadio", "Diabaté", "Konan", "Soro", "Aka", "Gnagne", "Fofana", "Brou"]
STAFF = [
    ("gerant", "Yao", "Kouassi", GERANT), ("caissier1", "Aya", "Traoré", CAISSIER),
    ("caissier2", "Moussa", "Coulibaly", CAISSIER), ("magasinier", "Sékou", "Bamba", MAGASINIER),
    ("preparateur", "Affoué", "Kouamé", PREPARATEUR), ("inventoriste", "Brice", "Gnagne", INVENTORISTE),
]


class Command(BaseCommand):
    help = "Crée des données de démonstration (catalogue, kits, stock, clients, ventes sur plusieurs mois)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=90, help="Durée de l'historique de ventes (jours).")
        parser.add_argument("--seed", type=int, default=2026)

    def handle(self, *args, **options):
        if Sale.objects.filter(notes__startswith=MARKER).exists():
            self.stdout.write("Les données de démonstration existent déjà : rien à faire.")
            return
        self.rng = random.Random(options["seed"])
        self.days = max(options["days"], 7)
        self.now = timezone.now()
        with transaction.atomic():
            self.created = []
            self.reference_data()
            self.users_and_devices()
            self.catalog()
            self.kits()
            self.customers_and_suppliers()
            # Les prix fixés à la création doivent valoir pour tout l'historique simulé.
            PriceHistory.objects.filter(article__in=self.created).update(
                changed_at=self.now - timedelta(days=self.days + 30))
            self.opening_stock()
        self.sales_history()
        self.online_orders()
        refresh_all_alerts()
        self.stdout.write(self.style.SUCCESS(
            f"Démo prête : {Article.objects.count()} articles, {Kit.objects.count()} kits, "
            f"{Customer.objects.count()} clients, {Sale.objects.count()} ventes, "
            f"{OnlineOrder.objects.count()} commandes en ligne. Mot de passe des comptes : {PASSWORD} (PIN {PIN})."))

    # --- Référentiels -------------------------------------------------------------------------

    def reference_data(self):
        self.depot = Depot.objects.get(code="MAG")
        Depot.objects.filter(pk=self.depot.pk).update(is_pickup_point=True)
        self.reserve = Depot.objects.filter(code="RES").first()
        self.locations = []
        for index, (code, label) in enumerate([("A1", "Cahiers"), ("A2", "Écriture"), ("B1", "Géométrie"),
                                               ("B2", "Papeterie"), ("C1", "Livres"), ("C2", "Kits")]):
            location, _ = Location.objects.get_or_create(depot=self.depot, code=code,
                                                         defaults={"label": label, "sort_order": index})
            self.locations.append(location)
        self.unit = Unit.objects.filter(code="U").first()
        year = SchoolYear.objects.filter(is_current=True).first()
        self.year = year
        self.schools = []
        for name, city, district, phone in SCHOOLS:
            school, _ = School.objects.get_or_create(name=name, city=city, defaults={"district": district,
                                                                                      "phone": phone})
            self.schools.append(school)

    def users_and_devices(self):
        self.devices = []
        # D01 / D02 portent l'historique simulé ; C01, C02 et T01 restent libres pour les essais en direct.
        for code, name in (("D01", "Caisse 1 (historique démo)"), ("D02", "Caisse 2 (historique démo)"),
                           ("C01", "Caisse principale"), ("C02", "Caisse 2"), ("T01", "Tablette préparation")):
            device, _ = Device.objects.get_or_create(code=code, defaults={"name": name,
                                                                            "kind": "TABLETTE" if code == "T01" else "CAISSE"})
            self.devices.append(device)
        self.staff = {}
        for username, first, last, role in STAFF:
            user = User.objects.filter(username=username).first()
            if user is None:
                user = User(username=username, first_name=first, last_name=last, role=Role.objects.get(code=role),
                            email=f"{username}@demo.librairie.ci")
                user.set_password(PASSWORD)
                user.set_pin(PIN)
                user.save()
            self.staff[username] = user
        self.clients = []
        for index in range(6):
            phone = f"070100{index:04d}"
            user = User.objects.filter(username=phone).first()
            if user is None:
                user = User(username=phone, phone=phone, first_name=FIRST_NAMES[index], last_name=LAST_NAMES[index],
                            role=Role.objects.get(code=CLIENT), email=f"client{index}@demo.librairie.ci")
                user.set_password(PASSWORD)
                user.save()
            self.clients.append(user)

    # --- Catalogue ----------------------------------------------------------------------------

    def category(self, name, parent=None):
        category, _ = Category.objects.get_or_create(name=name, parent=parent)
        return category

    def article(self, name, retail, cost, category, brand=None, threshold=10, type_=Article.Type.SIMPLE, online=True):
        article = Article.objects.filter(name=name).first()
        if article:
            return article
        article = Article.objects.create(
            code=next_article_code(type_), name=name, type=type_, category=category, unit=self.unit,
            brand=Brand.objects.get_or_create(name=brand)[0] if brand else None, retail_price=retail, avg_cost=cost,
            alert_threshold=threshold, is_online=online)
        if type_ != Article.Type.SERVICE:
            add_internal_barcode(article)
        self.created.append(article.pk)
        return article

    def catalog(self):
        self.articles = {}
        for (parent_name, child_name), rows in CATALOG.items():
            parent = self.category(parent_name)
            category = self.category(child_name, parent) if child_name else parent
            for name, retail, cost, brand, threshold in rows:
                self.articles[name] = self.article(name, retail, cost, category, brand, threshold)
        books = self.category("Livres scolaires")
        self.books = {}
        for level in SchoolLevel.objects.filter(is_active=True).order_by("sort_order"):
            sub = self.category({"PRIMAIRE": "Primaire", "COLLEGE": "Collège", "LYCEE": "Lycée"}[level.cycle], books)
            retail, cost = BOOK_PRICES[level.cycle]
            subjects = SUBJECTS[level.cycle][: 2 if level.cycle == "LYCEE" else 3]
            self.books[level.pk] = [self.article(f"{subject} {level.label} — manuel de l'élève", retail, cost, sub,
                                                 "Éditions du Golfe", 5) for subject in subjects]
        services = self.category("Services")
        for name, price in SERVICES:
            self.article(name, price, 0, services, threshold=0, type_=Article.Type.SERVICE, online=False)

    def kit_components(self, level):
        a = self.articles
        if level.cycle == "PRIMAIRE":
            items = [(a["Cahier 96 pages petit format seyès"], 4), (a["Cahier 48 pages petit format seyès"], 3),
                     (a["Cahier de brouillon 96 pages"], 1), (a["Ardoise blanche effaçable"], 1),
                     (a["Feutre ardoise effaçable"], 2), (a["Crayon à papier HB"], 3), (a["Gomme blanche"], 2),
                     (a["Boîte de 12 crayons de couleur"], 1), (a["Règle plate 20 cm"], 1),
                     (a["Protège-cahier petit format"], 7), (a["Stylo à bille bleu"], 2)]
            if level.code in ("CP1", "CP2"):
                items.append((a["Cahier d'activités CP1"], 1))
            elif level.code in ("CE1", "CE2"):
                items.append((a["Cahier d'activités CE1"], 1))
            else:
                items += [(a["Cahier d'activités CM1"], 1), (a["Kit de géométrie 4 pièces"], 1)]
        else:
            items = [(a["Cahier 200 pages grand format 24x32"], 4), (a["Cahier 100 pages grand format 24x32"], 4),
                     (a["Cahier de textes"], 1), (a["Stylo à bille bleu"], 3), (a["Stylo à bille rouge"], 2),
                     (a["Crayon à papier HB"], 2), (a["Gomme blanche"], 1), (a["Règle plate 30 cm"], 1),
                     (a["Équerre 21 cm"], 1), (a["Rapporteur 180°"], 1), (a["Compas simple"], 1),
                     (a["Protège-cahier grand format"], 8), (a["Paquet de copies doubles grand format (100)"], 1)]
            if level.cycle == "LYCEE":
                items += [(a["Calculatrice scientifique"], 1), (a["Surligneur jaune"], 2)]
        return items + [(book, 1) for book in self.books[level.pk]]

    def kits(self):
        kits_category = self.category("Kits scolaires")
        for school_index, school in enumerate(self.schools):
            for level in SchoolLevel.objects.filter(is_active=True).order_by("sort_order"):
                name = f"Kit {level.label} — {school.name}"
                if Article.objects.filter(name=name).exists():
                    continue
                article = self.article(name, 0, 0, kits_category, threshold=0, type_=Article.Type.KIT)
                kit = Kit.objects.create(article=article, level=level, school=school, school_year=self.year,
                                         discount_percent=Decimal(5 + school_index * 2),
                                         pricing_mode=Kit.PricingMode.COMPUTED, stock_mode=Kit.StockMode.VIRTUAL)
                components = self.kit_components(level)
                # Chaque établissement a sa liste : quelques variations de quantités.
                for order, (component, quantity) in enumerate(components):
                    extra = 1 if (school_index + order) % 5 == 0 and quantity > 1 else 0
                    KitComponent.objects.create(kit=kit, article=component, quantity=quantity + extra,
                                                is_optional=component.type == Article.Type.SIMPLE
                                                and component.retail_price >= 10000, sort_order=order)
                refresh_kit_price(kit)

    def customers_and_suppliers(self):
        self.customers = []
        for index in range(40):
            first, last = self.rng.choice(FIRST_NAMES), self.rng.choice(LAST_NAMES)
            phone = f"{self.rng.choice(['07', '05', '01'])}{self.rng.randint(10000000, 99999999)}"
            customer, _ = Customer.objects.get_or_create(
                phone=phone, defaults={"name": f"{first} {last}", "school": self.rng.choice(self.schools),
                                       "credit_limit": self.rng.choice([0, 0, 0, 20000, 50000])})
            self.customers.append(customer)
        for client in self.clients:
            self.customers.append(orders.customer_for_user(client))
        self.suppliers = []
        for name, contact, phone, lead in SUPPLIERS:
            supplier, _ = Supplier.objects.get_or_create(name=name, defaults={"contact_name": contact, "phone": phone,
                                                                              "lead_time_days": lead})
            self.suppliers.append(supplier)

    def opening_stock(self):
        received_at = self.now - timedelta(days=self.days + 10)
        stocked = list(Article.objects.filter(type=Article.Type.SIMPLE, is_active=True))
        for index in range(0, len(stocked), 25):
            lines = []
            for article in stocked[index:index + 25]:
                base = 600 if article.retail_price <= 300 else 250 if article.retail_price <= 1500 else 60
                lines.append({"article": article, "quantity": self.rng.randint(base // 2, base),
                              "unit_cost": int(article.avg_cost)})
            receive_goods(supplier=self.suppliers[(index // 25) % len(self.suppliers)], depot=self.depot, lines=lines,
                          user=self.staff["magasinier"], received_at=received_at,
                          delivery_note=f"BL-DEMO-{index // 25 + 1:03d}", note=MARKER)

    # --- Ventes ---------------------------------------------------------------------------------

    def ctx(self, user, device, when):
        return SyncContext(user=user, device=device, client_timestamp=when, operation_id=uuid.uuid4())

    def sales_history(self):
        simple = list(Article.objects.filter(type=Article.Type.SIMPLE, is_active=True))
        weights = [max(1, 3000 // max(int(a.retail_price), 100)) for a in simple]
        kits = list(Article.objects.filter(type=Article.Type.KIT))
        services = list(Article.objects.filter(type=Article.Type.SERVICE))
        cashiers = [self.staff["caissier1"], self.staff["caissier2"]]
        methods = ["CASH"] * 6 + ["ORANGE_MONEY", "ORANGE_MONEY", "MTN_MOMO", "WAVE", "MOOV_MONEY"]
        today = timezone.localdate()
        count = 0
        for offset in range(self.days, 0, -1):
            day = today - timedelta(days=offset)
            if day.weekday() == 6:  # fermé le dimanche
                continue
            if offset % 7 == 0:
                self.replenish(day)
            rentree = day.month == 9 or (day.month == 8 and day.day >= 20) or (day.month == 10 and day.day <= 5)
            n_sales = self.rng.randint(25, 45) if rentree else self.rng.randint(6, 14)
            for device_index, device in enumerate(self.devices[:2]):
                if device_index == 1 and not rentree:
                    continue
                cashier = cashiers[device_index]
                opened = timezone.make_aware(datetime.combine(day, time(7, 30)))
                with transaction.atomic():
                    session = sales.open_session(self.ctx(cashier, device, opened), {
                        "id": str(uuid.uuid4()), "depot": str(self.depot.pk), "opening_float": 20000})
                    for seq in range(1, n_sales // (2 if rentree else 1) + 1):
                        when = opened + timedelta(minutes=self.rng.randint(30, 10 * 60))
                        lines = []
                        if rentree and self.rng.random() < 0.45:
                            lines.append((self.rng.choice(kits), 1))
                        for article in self.rng.choices(simple, weights=weights, k=self.rng.randint(1, 4)):
                            lines.append((article, self.rng.randint(1, 3)))
                        if self.rng.random() < 0.08:
                            lines.append((self.rng.choice(services), self.rng.randint(1, 20)))
                        customer = self.rng.choice(self.customers) if self.rng.random() < 0.3 else None
                        self.sell(cashier, device, session, day, seq, when, lines, customer, self.rng.choice(methods))
                        count += 1
                    expected = sales.expected_cash(session)
                    variance = self.rng.choice([0] * 8 + [-500, -200, 100, 250])
                    sales.close_session(self.ctx(cashier, device, opened + timedelta(hours=11)), {
                        "session": str(session.pk), "counted_cash": expected + variance,
                        "z_number": f"Z-{device.code}-{day:%Y%m%d}"})
        self.replenish(today)
        self.stdout.write(f"{count} ventes générées.")

    def replenish(self, day):
        """Réassort hebdomadaire : les articles sous leur stock cible sont recomplétés."""
        from apps.stock.services import on_hand

        lines = []
        for article in Article.objects.filter(type=Article.Type.SIMPLE, is_active=True):
            target = 600 if article.retail_price <= 300 else 300 if article.retail_price <= 1500 else 80
            missing = target - on_hand(article, self.depot)
            if missing > target // 3:
                lines.append({"article": article, "quantity": missing, "unit_cost": int(article.avg_cost)})
        if lines:
            receive_goods(supplier=self.rng.choice(self.suppliers), depot=self.depot, lines=lines,
                          user=self.staff["magasinier"],
                          received_at=timezone.make_aware(datetime.combine(day, time(7, 0))),
                          delivery_note=f"BL-DEMO-{day:%m%d}", note=MARKER)

    def sell(self, cashier, device, session, day, seq, when, lines, customer, method):
        merged = {}
        for article, quantity in lines:
            merged[article.pk] = (article, merged.get(article.pk, (article, 0))[1] + quantity)
        payload_lines, subtotal = [], 0
        for article, quantity in merged.values():
            price, _kind = sales.catalog_unit_price(article, quantity, when)
            payload_lines.append({"article": str(article.pk), "quantity": quantity, "unit_price": price,
                                  "line_total": price * quantity})
            subtotal += price * quantity
        if method == "CASH":
            paid = -(-subtotal // 500) * 500
            payments = [{"method": "CASH", "amount": paid}]
        else:
            paid = subtotal
            payments = [{"method": method, "amount": subtotal, "reference": f"TX{self.rng.randint(10**8, 10**9)}"}]
        sales.create_sale(self.ctx(cashier, device, when), {
            "id": str(uuid.uuid4()), "receipt_number": f"{device.code}-{day:%Y%m%d}-{seq:04d}",
            "depot": str(self.depot.pk), "cash_session": str(session.pk),
            "customer": str(customer.pk) if customer else None, "lines": payload_lines, "subtotal": subtotal,
            "global_discount": 0, "total": subtotal, "payments": payments, "change_due": paid - subtotal,
            "notes": MARKER})

    # --- Commandes en ligne ---------------------------------------------------------------------

    def online_orders(self):
        kits = list(Article.objects.filter(type=Article.Type.KIT, is_online=True)[:20])
        small = list(Article.objects.filter(type=Article.Type.SIMPLE, is_online=True, retail_price__lte=1500)[:30])
        preparer, manager = self.staff["preparateur"], self.staff["gerant"]
        scenarios = ["RECEIVED", "RECEIVED", "CONFIRMED", "PREPARING", "READY", "READY", "PICKED_UP", "PICKED_UP",
                     "CANCELLED", "EXPIRED"]
        for index, target in enumerate(scenarios):
            client = self.clients[index % len(self.clients)]
            lines = [{"article": self.rng.choice(kits).pk, "quantity": 1}] if index % 2 == 0 else []
            lines += [{"article": a.pk, "quantity": self.rng.randint(1, 3)} for a in self.rng.sample(small, 2)]
            try:
                order = orders.place_order(client, {"lines": lines, "comment": "Commande de démonstration"})
            except Exception as exc:  # noqa: BLE001 — stock insuffisant après les ventes simulées
                self.stdout.write(f"Commande de démonstration ignorée : {exc}")
                continue
            if target == "RECEIVED":
                continue
            if target == "CANCELLED":
                orders.cancel(order, client, by_customer=True)
                continue
            orders.confirm(order, manager)
            if target == "CONFIRMED":
                continue
            order.refresh_from_db()
            prepared = [{"line": str(l.pk), "prepared_qty": l.quantity} for l in order.lines.all()]
            orders.prepare(order, preparer, lines=prepared, ready=target != "PREPARING")
            order.refresh_from_db()
            if target == "EXPIRED":
                # Délai de retrait dépassé pour cette seule commande, puis passage de la tâche d'expiration.
                OnlineOrder.objects.filter(pk=order.pk).update(expires_at=timezone.now() - timedelta(hours=1))
                orders.expire_due()
            elif target == "PICKED_UP":
                self.pickup(order, index)

    def pickup(self, order, index):
        device = self.devices[0]
        cashier = self.staff["caissier1"]
        now = timezone.now()
        session = sales.CashSession.objects.filter(device=device, status="OPEN").first() or sales.open_session(
            self.ctx(cashier, device, now), {"id": str(uuid.uuid4()), "depot": str(self.depot.pk), "opening_float": 0})
        lines = [{"article": str(l.article_id), "quantity": l.quantity, "unit_price": l.unit_price,
                  "line_total": l.line_total} for l in order.lines.filter(quantity__gt=0)]
        sales.create_sale(self.ctx(cashier, device, now), {
            "id": str(uuid.uuid4()), "receipt_number": f"{device.code}-{now:%Y%m%d}-{900 + index:04d}",
            "depot": str(self.depot.pk), "cash_session": str(session.pk), "online_order": str(order.pk),
            "lines": lines, "subtotal": order.total, "global_discount": 0, "total": order.total,
            "payments": [{"method": "CASH", "amount": order.total}], "change_due": 0,
            "notes": f"{MARKER} retrait {order.number}"})
