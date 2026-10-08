"""Constructeurs de données de test du catalogue."""
from decimal import Decimal

from apps.catalog.models import Article, Category, Kit, KitComponent, SchoolLevel, SchoolYear
from apps.catalog.services import next_article_code, refresh_kit_price


def make_article(name="Cahier 100 pages", retail=400, cost=250, type_=Article.Type.SIMPLE, **extra):
    return Article.objects.create(code=extra.pop("code", None) or next_article_code(type_), name=name,
                                  type=type_, retail_price=retail, avg_cost=cost, **extra)


def make_kit(components, name="Kit 6ème", discount=Decimal("0"), pricing_mode=Kit.PricingMode.COMPUTED,
             stock_mode=Kit.StockMode.VIRTUAL, price=0, level_code="6EME", school=None):
    """`components` : liste de (article, quantité[, facultatif])."""
    article = Article.objects.create(code=next_article_code(Article.Type.KIT), name=name, type=Article.Type.KIT,
                                     retail_price=price,
                                     category=Category.objects.filter(name="Kits scolaires").first())
    kit = Kit.objects.create(article=article, level=SchoolLevel.objects.get(code=level_code), school=school,
                             school_year=SchoolYear.current(), discount_percent=discount,
                             pricing_mode=pricing_mode, stock_mode=stock_mode)
    for order, spec in enumerate(components):
        component_article, quantity = spec[0], spec[1]
        KitComponent.objects.create(kit=kit, article=component_article, quantity=quantity,
                                    is_optional=spec[2] if len(spec) > 2 else False, sort_order=order)
    refresh_kit_price(kit)
    kit.refresh_from_db()
    return kit
