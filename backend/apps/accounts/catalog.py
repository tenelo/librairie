"""Catalogue des permissions et matrice par défaut des rôles.

Ce fichier est la source de vérité initiale ; la matrice reste ensuite modifiable par
l'administrateur (écran « Rôles & permissions »). La commande `sync_roles` réinsère les
permissions manquantes sans écraser les choix de l'administrateur, sauf avec `--reset`.
"""

ADMIN = "ADMIN"
GERANT = "GERANT"
CAISSIER = "CAISSIER"
MAGASINIER = "MAGASINIER"
PREPARATEUR = "PREPARATEUR"
INVENTORISTE = "INVENTORISTE"
CLIENT = "CLIENT"

ROLE_CHOICES = [
    (ADMIN, "Administrateur"),
    (GERANT, "Gérant"),
    (CAISSIER, "Caissier"),
    (MAGASINIER, "Magasinier"),
    (PREPARATEUR, "Préparateur"),
    (INVENTORISTE, "Inventoriste"),
    (CLIENT, "Client"),
]

# (code, libellé, module)
PERMISSIONS = [
    ("dashboard.view", "Voir le tableau de bord", "Tableau de bord"),
    ("sales.create", "Enregistrer des ventes", "Caisse"),
    ("sales.view", "Consulter l'historique des ventes", "Caisse"),
    ("sales.hold", "Mettre des ventes en attente", "Caisse"),
    ("sales.return", "Effectuer des retours", "Caisse"),
    ("sales.authorize", "Autoriser remises et retours (PIN gérant)", "Caisse"),
    ("sales.reprint", "Réimprimer des reçus", "Caisse"),
    ("cash.open_close", "Ouvrir et clôturer une caisse", "Caisse"),
    ("cash.z_report", "Consulter les rapports Z", "Caisse"),
    ("orders.view", "Consulter les commandes en ligne", "Commandes en ligne"),
    ("orders.confirm", "Confirmer ou annuler les commandes", "Commandes en ligne"),
    ("orders.prepare", "Préparer les commandes", "Commandes en ligne"),
    ("orders.pickup", "Remettre les commandes au client", "Commandes en ligne"),
    ("catalog.view", "Consulter le catalogue", "Catalogue"),
    ("catalog.manage", "Gérer articles, kits et catégories", "Catalogue"),
    ("catalog.prices", "Modifier les prix", "Catalogue"),
    ("catalog.import", "Importer et exporter le catalogue", "Catalogue"),
    ("stock.view", "Consulter les stocks", "Stock"),
    ("stock.manage", "Ajustements, pertes et casse", "Stock"),
    ("stock.transfer", "Transferts entre dépôts", "Stock"),
    ("stock.kit_assembly", "Assembler et désassembler des kits", "Stock"),
    ("purchasing.view", "Consulter les achats", "Achats"),
    ("purchasing.manage", "Gérer fournisseurs et bons de commande", "Achats"),
    ("purchasing.receive", "Réceptionner des marchandises", "Achats"),
    ("inventory.view", "Consulter les inventaires", "Inventaires"),
    ("inventory.create", "Créer des inventaires", "Inventaires"),
    ("inventory.count", "Saisir des comptages", "Inventaires"),
    ("inventory.validate", "Valider des inventaires", "Inventaires"),
    ("customers.view", "Consulter les clients", "Clients"),
    ("customers.manage", "Gérer clients, crédits et fidélité", "Clients"),
    ("stats.view", "Consulter les statistiques", "Statistiques"),
    ("audit.view", "Consulter le journal d'audit", "Audit"),
    ("sync.view", "Consulter la synchronisation", "Synchronisation"),
    ("sync.manage", "Résoudre les conflits de synchronisation", "Synchronisation"),
    ("accounts.manage_users", "Gérer les utilisateurs", "Administration"),
    ("accounts.manage_roles", "Gérer les rôles et permissions", "Administration"),
    ("accounts.manage_devices", "Gérer les terminaux", "Administration"),
    ("settings.manage", "Gérer les paramètres de la librairie", "Administration"),
    ("shop.order", "Commander sur la boutique en ligne", "Boutique"),
]

ALL_CODES = [code for code, _label, _module in PERMISSIONS]

_STAFF_BASE = ["dashboard.view", "catalog.view", "stock.view", "sync.view"]

DEFAULT_ROLE_MATRIX = {
    ADMIN: {
        "label": "Administrateur",
        "is_staff_role": True,
        "max_discount_percent": 100,
        "permissions": [c for c in ALL_CODES if c != "shop.order"],
    },
    GERANT: {
        "label": "Gérant",
        "is_staff_role": True,
        "max_discount_percent": 30,
        "permissions": [
            c
            for c in ALL_CODES
            if not c.startswith("accounts.") and c not in ("settings.manage", "shop.order")
        ],
    },
    CAISSIER: {
        "label": "Caissier",
        "is_staff_role": True,
        "max_discount_percent": 5,
        "permissions": _STAFF_BASE
        + [
            "sales.create",
            "sales.view",
            "sales.hold",
            "sales.return",
            "cash.open_close",
            "cash.z_report",
            "customers.view",
            "customers.manage",
            "orders.view",
            "orders.pickup",
        ],
    },
    MAGASINIER: {
        "label": "Magasinier",
        "is_staff_role": True,
        "max_discount_percent": 0,
        "permissions": _STAFF_BASE
        + [
            "stock.manage",
            "stock.transfer",
            "stock.kit_assembly",
            "purchasing.view",
            "purchasing.receive",
        ],
    },
    PREPARATEUR: {
        "label": "Préparateur",
        "is_staff_role": True,
        "max_discount_percent": 0,
        "permissions": _STAFF_BASE + ["orders.view", "orders.prepare"],
    },
    INVENTORISTE: {
        "label": "Inventoriste",
        "is_staff_role": True,
        "max_discount_percent": 0,
        "permissions": _STAFF_BASE + ["inventory.view", "inventory.count"],
    },
    CLIENT: {
        "label": "Client",
        "is_staff_role": False,
        "max_discount_percent": 0,
        "permissions": ["shop.order"],
    },
}


def sync_permissions_and_roles(permission_model, role_model, reset=False):
    """Crée les permissions et rôles manquants.

    Les modèles sont passés en paramètre pour pouvoir être appelée depuis une migration
    (modèles historiques) comme depuis une commande de gestion.
    """
    by_code = {}
    for code, label, module in PERMISSIONS:
        perm, _ = permission_model.objects.update_or_create(code=code, defaults={"label": label, "module": module})
        by_code[code] = perm
    for code, spec in DEFAULT_ROLE_MATRIX.items():
        role, created = role_model.objects.get_or_create(
            code=code,
            defaults={
                "label": spec["label"],
                "is_staff_role": spec["is_staff_role"],
                "max_discount_percent": spec["max_discount_percent"],
            },
        )
        if created or reset:
            role.label = spec["label"]
            role.is_staff_role = spec["is_staff_role"]
            role.max_discount_percent = spec["max_discount_percent"]
            role.save()
            role.permissions.set([by_code[c] for c in spec["permissions"]])
