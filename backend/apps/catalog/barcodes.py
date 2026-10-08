"""Codes-barres EAN-13 : contrôle et génération des codes internes imprimables.

Les codes internes utilisent le préfixe GS1 « 2 » (usage interne au magasin, jamais attribué
à un fabricant), suivi de « 0 » puis d'un numéro séquentiel sur 10 chiffres et de la clé
de contrôle. Ils sont donc lisibles par toutes les douchettes sans risque de collision avec
un code fabricant.
"""
from apps.core.models import next_counter

INTERNAL_PREFIX = "20"
INTERNAL_COUNTER = "barcode.internal"


def ean13_check_digit(first12: str) -> str:
    if len(first12) != 12 or not first12.isdigit():
        raise ValueError("Il faut exactement 12 chiffres.")
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(first12))
    return str((10 - total % 10) % 10)


def is_valid_ean13(code: str) -> bool:
    return len(code) == 13 and code.isdigit() and ean13_check_digit(code[:12]) == code[12]


def is_internal_code(code: str) -> bool:
    return is_valid_ean13(code) and code.startswith(INTERNAL_PREFIX)


def generate_internal_ean13() -> str:
    """Prochain code interne unique (compteur atomique)."""
    from .models import Barcode

    while True:
        number = next_counter(INTERNAL_COUNTER)
        first12 = f"{INTERNAL_PREFIX}{number:010d}"
        code = first12 + ean13_check_digit(first12)
        # Garde-fou si un code interne a été saisi manuellement auparavant.
        if not Barcode.all_objects.filter(code=code).exists():
            return code
