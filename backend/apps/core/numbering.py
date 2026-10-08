"""Numérotation des documents (transferts, bons de commande, réceptions…) : PREFIXE-AAAA-00001."""
from django.utils import timezone

from .models import next_counter


def next_document_number(prefix: str, width: int = 5) -> str:
    year = timezone.localdate().year
    return f"{prefix}-{year}-{next_counter(f'doc.{prefix}.{year}'):0{width}d}"
