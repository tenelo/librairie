from django import template

register = template.Library()


@register.filter
def fcfa(value):
    """12500 → « 12 500 FCFA » (espace insécable comme séparateur de milliers)."""
    try:
        amount = int(round(float(value)))
    except (TypeError, ValueError):
        return ""
    return f"{amount:,}".replace(",", " ") + " FCFA"
