"""Calculs monétaires en FCFA (montants entiers, sans décimales)."""
from decimal import ROUND_HALF_UP, Decimal


def to_fcfa(value) -> int:
    """Arrondit au franc le plus proche (demi-unité arrondie au supérieur)."""
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def round_fcfa(value, step: int = 1) -> int:
    """Arrondit au multiple de `step` le plus proche (ex. 5 FCFA, plus petite pièce courante)."""
    step = max(int(step or 1), 1)
    amount = Decimal(str(value)) / step
    return int(amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP)) * step


def apply_discount(amount, percent) -> Decimal:
    """Applique une remise en pourcentage ; renvoie un Decimal non arrondi."""
    return Decimal(str(amount)) * (Decimal("100") - Decimal(str(percent or 0))) / Decimal("100")
