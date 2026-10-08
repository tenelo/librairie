"""Règles métier du catalogue : codes, prix des kits, disponibilité, personnalisation et duplication.

Les fonctions de calcul (prix, disponibilité, personnalisation) sont pures vis-à-vis du stock :
elles reçoivent une fonction `stock_of(article_id) -> int`. Le module stock (phase 3) et la
base locale hors connexion (phase 4) fournissent chacun leur propre implémentation.
"""
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, Optional

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.core.models import next_counter
from apps.core.money import apply_discount, round_fcfa, to_fcfa
from apps.settings_app.models import LibrarySettings

from .barcodes import generate_internal_ean13
from .models import Article, Barcode, Kit, KitComponent, PriceHistory

StockLookup = Callable[[object], int]

CODE_PREFIXES = {
    Article.Type.SIMPLE: "ART",
    Article.Type.KIT: "KIT",
    Article.Type.LOT: "LOT",
    Article.Type.SERVICE: "SRV",
}

PRICE_FIELDS = ("retail_price", "wholesale_price", "wholesale_min_qty", "avg_cost", "vat_rate", "vat_exempt")


def next_article_code(article_type: str) -> str:
    prefix = CODE_PREFIXES.get(article_type, "ART")
    while True:
        code = f"{prefix}-{next_counter(f'article.{prefix}'):05d}"
        if not Article.all_objects.filter(code=code).exists():
            return code


def add_internal_barcode(article: Article) -> Barcode:
    return Barcode.objects.create(article=article, code=generate_internal_ean13(), kind=Barcode.Kind.INTERNAL)


def record_price_changes(article: Article, before: dict, user=None, reason: str = "") -> list:
    """Historise les champs de prix modifiés ; renvoie la liste des changements."""
    changes = []
    for name in PRICE_FIELDS:
        old, new = before.get(name), getattr(article, name)
        if str(old) != str(new):
            changes.append(
                PriceHistory(
                    article=article,
                    field=name,
                    old_value="" if old is None else str(old),
                    new_value="" if new is None else str(new),
                    reason=reason,
                    changed_by=user,
                )
            )
    PriceHistory.objects.bulk_create(changes)
    return changes


def price_snapshot(article: Article) -> dict:
    return {name: getattr(article, name) for name in PRICE_FIELDS}


# --- Prix des kits -----------------------------------------------------------------------


@dataclass
class KitPricing:
    components_total: int
    discount_percent: Decimal
    computed_price: int
    price: int
    cost: int
    margin: int
    margin_rate: Optional[Decimal]

    def as_dict(self):
        return {
            "components_total": self.components_total,
            "discount_percent": str(self.discount_percent),
            "computed_price": self.computed_price,
            "price": self.price,
            "cost": self.cost,
            "margin": self.margin,
            "margin_rate": None if self.margin_rate is None else str(self.margin_rate),
        }


def _live_components(kit: Kit):
    return [c for c in kit.components.all() if not c.is_deleted]


def compute_kit_pricing(kit: Kit, rounding: Optional[int] = None) -> KitPricing:
    """Prix d'un kit : somme des composants (prix détail × quantité), remise kit, arrondi.

    Les composants facultatifs sont inclus : le client peut les retirer à la vente.
    En mode FIXED, le prix retenu est celui de l'article ; le prix calculé reste affiché
    pour comparaison. La marge est calculée sur le coût moyen pondéré des composants.
    """
    if rounding is None:
        rounding = LibrarySettings.load().price_rounding
    components = _live_components(kit)
    total = sum(int(c.article.retail_price) * c.quantity for c in components)
    cost = sum(int(c.article.avg_cost) * c.quantity for c in components)
    computed = round_fcfa(apply_discount(total, kit.discount_percent), rounding)
    price = computed if kit.pricing_mode == Kit.PricingMode.COMPUTED else int(kit.article.retail_price)
    margin = price - cost
    rate = (Decimal(margin) * 100 / Decimal(price)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP) if price else None
    return KitPricing(total, Decimal(kit.discount_percent), computed, price, cost, margin, rate)


def refresh_kit_price(kit: Kit, user=None) -> KitPricing:
    """Met à jour le prix (et le coût) de l'article kit selon son mode de prix."""
    pricing = compute_kit_pricing(kit)
    article = kit.article
    before = price_snapshot(article)
    fields = []
    if kit.pricing_mode == Kit.PricingMode.COMPUTED and article.retail_price != pricing.computed_price:
        article.retail_price = pricing.computed_price
        fields.append("retail_price")
    if article.avg_cost != pricing.cost:
        article.avg_cost = pricing.cost
        fields.append("avg_cost")
    if fields:
        article.save(update_fields=fields)
        record_price_changes(article, before, user=user, reason="Recalcul du kit")
    return pricing


def refresh_kits_using(article: Article, user=None) -> int:
    """Recalcule les kits en mode calculé qui contiennent l'article (après un changement de prix)."""
    kits = Kit.objects.filter(
        components__article=article, components__is_deleted=False, pricing_mode=Kit.PricingMode.COMPUTED
    ).distinct()
    count = 0
    for kit in kits.select_related("article"):
        refresh_kit_price(kit, user=user)
        count += 1
    return count


# --- Disponibilité -------------------------------------------------------------------------


def article_availability(article: Article, stock_of: StockLookup) -> Optional[int]:
    """Quantité vendable d'un article ; None signifie « illimitée » (service).

    - SIMPLE : son stock ;
    - LOT : stock de l'article de base ÷ unités par lot (arrondi inférieur) ;
    - KIT pré-assemblé : son propre stock ;
    - KIT virtuel : minimum, sur les composants obligatoires, de (disponibilité ÷ quantité requise).
    """
    if article.type == Article.Type.SERVICE:
        return None
    if article.type == Article.Type.SIMPLE:
        return max(int(stock_of(article.pk)), 0)
    if article.type == Article.Type.LOT:
        if not article.lot_base_article_id or not article.lot_units:
            return 0
        return max(int(stock_of(article.lot_base_article_id)), 0) // article.lot_units
    kit = article.kit
    if kit.stock_mode == Kit.StockMode.ASSEMBLED:
        return max(int(stock_of(article.pk)), 0)
    return kit_virtual_availability(kit, stock_of)


def kit_virtual_availability(kit: Kit, stock_of: StockLookup) -> int:
    limits = []
    for component in _live_components(kit):
        if component.is_optional:
            continue
        available = article_availability(component.article, stock_of)
        if available is None:
            continue
        limits.append(available // component.quantity)
    return min(limits) if limits else 0


# --- Personnalisation à la vente (retrait / substitution) ---------------------------------


@dataclass
class KitCustomization:
    base_price: int
    price: int
    lines: list = field(default_factory=list)
    adjustments: list = field(default_factory=list)

    def as_dict(self):
        return {"base_price": self.base_price, "price": self.price, "lines": self.lines,
                "adjustments": self.adjustments}


def customize_kit(kit: Kit, removed=(), substitutions=None, rounding: Optional[int] = None) -> KitCustomization:
    """Calcule le prix d'un kit dont le client retire ou remplace des composants.

    Chaque ajustement est valorisé au prix détail du composant, remise kit appliquée,
    ce qui reste cohérent avec un prix calculé et équitable pour un prix fixe :
      - retrait : −(prix composant × quantité) × (1 − remise) ;
      - substitution : +(prix équivalent − prix composant) × quantité × (1 − remise).
    Le résultat sert d'aperçu (API) et sera rejoué à l'identique côté caisse hors ligne.
    """
    if rounding is None:
        rounding = LibrarySettings.load().price_rounding
    substitutions = {str(k): str(v) for k, v in (substitutions or {}).items()}
    removed = {str(r) for r in removed}
    components = {str(c.pk): c for c in _live_components(kit)}

    unknown = (removed | set(substitutions)) - set(components)
    if unknown:
        raise ValidationError({"components": f"Composants inconnus pour ce kit : {', '.join(sorted(unknown))}."})
    both = removed & set(substitutions)
    if both:
        raise ValidationError({"components": "Un composant ne peut pas être à la fois retiré et remplacé."})

    base_price = compute_kit_pricing(kit, rounding).price
    delta = Decimal(0)
    lines, adjustments = [], []
    for key, component in components.items():
        if key in removed:
            value = apply_discount(int(component.article.retail_price) * component.quantity, kit.discount_percent)
            delta -= value
            adjustments.append({"action": "REMOVED", "component": key, "article": str(component.article_id),
                                "quantity": component.quantity, "price_delta": -to_fcfa(value)})
            continue
        article = component.article
        if key in substitutions:
            substitute = next((s for s in component.substitutes.all() if str(s.pk) == substitutions[key]), None)
            if substitute is None:
                raise ValidationError(
                    {"substitutions": f"« {component.article.name} » ne peut pas être remplacé par cet article."}
                )
            difference = (int(substitute.retail_price) - int(article.retail_price)) * component.quantity
            value = apply_discount(difference, kit.discount_percent)
            delta += value
            adjustments.append({"action": "SUBSTITUTED", "component": key, "article": str(article.pk),
                                "substitute": str(substitute.pk), "quantity": component.quantity,
                                "price_delta": to_fcfa(value)})
            article = substitute
        lines.append({"component": key, "article": str(article.pk), "code": article.code, "name": article.name,
                      "quantity": component.quantity})

    price = max(round_fcfa(Decimal(base_price) + delta, rounding), 0)
    return KitCustomization(base_price=base_price, price=price, lines=lines, adjustments=adjustments)


# --- Duplication ---------------------------------------------------------------------------


@transaction.atomic
def duplicate_kit(kit: Kit, *, name=None, level=None, school=None, school_year=None, keep_school=True,
                  user=None) -> Kit:
    """Copie un kit (vers un autre niveau, établissement ou année) avec sa composition."""
    source = kit.article
    article = Article.objects.create(
        code=next_article_code(Article.Type.KIT),
        name=name or f"{source.name} (copie)",
        description=source.description,
        type=Article.Type.KIT,
        category=source.category,
        brand=source.brand,
        unit=source.unit,
        retail_price=source.retail_price,
        avg_cost=source.avg_cost,
        vat_rate=source.vat_rate,
        vat_exempt=source.vat_exempt,
        alert_threshold=source.alert_threshold,
        is_active=source.is_active,
        is_online=source.is_online,
    )
    add_internal_barcode(article)
    copy = Kit.objects.create(
        article=article,
        level=level or kit.level,
        school=school if school is not None else (kit.school if keep_school else None),
        school_year=school_year or kit.school_year,
        pricing_mode=kit.pricing_mode,
        discount_percent=kit.discount_percent,
        stock_mode=kit.stock_mode,
        notes=kit.notes,
    )
    for component in _live_components(kit):
        new_component = KitComponent.objects.create(
            kit=copy, article=component.article, quantity=component.quantity,
            is_optional=component.is_optional, sort_order=component.sort_order,
        )
        new_component.substitutes.set(component.substitutes.all())
    refresh_kit_price(copy, user=user)
    return copy
