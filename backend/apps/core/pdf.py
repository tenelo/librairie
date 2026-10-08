"""Génération de PDF (WeasyPrint) à partir de gabarits HTML Django.

WeasyPrint dépend de bibliothèques système (Pango, HarfBuzz) installées dans l'image Docker.
Si elles manquent (poste de développement Windows sans GTK), `PdfUnavailable` est levée et
l'API répond par un message explicite plutôt que par une erreur 500.
"""
from django.template.loader import render_to_string


class PdfUnavailable(RuntimeError):
    pass


def render_html(template: str, context: dict) -> str:
    return render_to_string(template, context)


def render_pdf(template: str, context: dict, base_url: str = "") -> bytes:
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as exc:
        raise PdfUnavailable(
            "La génération PDF n'est pas disponible sur ce serveur (bibliothèques WeasyPrint manquantes)."
        ) from exc
    return HTML(string=render_html(template, context), base_url=base_url or None).write_pdf()
