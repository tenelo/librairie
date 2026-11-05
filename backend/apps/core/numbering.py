"""Numérotation des codes générés par le serveur.

- Documents (transferts, bons de commande, réceptions…) : PREFIXE-AAAA-00001, compteur remis à 1
  chaque année.
- Articles : PREFIXE-00001, compteur continu par préfixe.

Le préfixe et le nombre de chiffres de chaque type de code se règlent dans Administration › Codes
et numérotation (modèle `CodeSetting`) ; sans réglage, les valeurs par défaut ci-dessous s'appliquent.
Les compteurs sont propres à chaque préfixe : un nouveau préfixe repart à 1, sans doublon possible.
"""
from dataclasses import dataclass

from django.utils import timezone

from .models import CodeSetting, SyncCounter, next_counter


@dataclass(frozen=True)
class CodeRule:
    key: str
    label: str
    kind: str  # "document" (PREFIXE-AAAA-N) ou "article" (PREFIXE-N)
    width: int = 5


CODE_RULES: dict[str, CodeRule] = {rule.key: rule for rule in [
    CodeRule("TR", "Transfert entre dépôts", "document"),
    CodeRule("ASM", "Assemblage de kits", "document"),
    CodeRule("INV", "Inventaire", "document"),
    CodeRule("BC", "Bon de commande fournisseur", "document"),
    CodeRule("REC", "Réception de marchandise", "document"),
    CodeRule("TS", "Souscription tontine scolaire", "document"),
    CodeRule("CMD", "Commande en ligne", "document"),
    CodeRule("ART", "Article simple", "article"),
    CodeRule("KIT", "Kit", "article"),
    CodeRule("LOT", "Lot", "article"),
    CodeRule("SRV", "Service", "article"),
]}


def code_format(key: str) -> tuple[str, int]:
    """(préfixe, nombre de chiffres) en vigueur pour un type de code."""
    rule = CODE_RULES.get(key)
    setting = CodeSetting.objects.filter(key=key).first()
    if setting:
        return setting.prefix, setting.width
    return key, rule.width if rule else 5


def counter_name(key: str, prefix: str, year: int | None = None) -> str:
    rule = CODE_RULES.get(key)
    if rule and rule.kind == "article":
        return f"article.{prefix}"
    return f"doc.{prefix}.{year or timezone.localdate().year}"


def format_code(key: str, prefix: str, width: int, number: int, year: int | None = None) -> str:
    rule = CODE_RULES.get(key)
    if rule and rule.kind == "article":
        return f"{prefix}-{number:0{width}d}"
    return f"{prefix}-{year or timezone.localdate().year}-{number:0{width}d}"


def current_counter(key: str, prefix: str) -> int:
    counter = SyncCounter.objects.filter(name=counter_name(key, prefix)).first()
    return counter.value if counter else 0


def next_document_number(key: str) -> str:
    year = timezone.localdate().year
    prefix, width = code_format(key)
    return format_code(key, prefix, width, next_counter(counter_name(key, prefix, year)), year)


def next_article_number(key: str) -> str:
    prefix, width = code_format(key)
    return format_code(key, prefix, width, next_counter(counter_name(key, prefix)))
