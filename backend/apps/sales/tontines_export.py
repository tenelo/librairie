"""Export Excel des souscriptions (tontine scolaire) pour préparer les approvisionnements.

Trois feuilles :
1. « TCD kits et articles » : quantités souscrites par kit et par article, avec le stock disponible
   et la quantité à commander (formule Excel, recalculée si on corrige un stock).
2. « Besoin en articles » : chaque kit virtuel décomposé en ses articles, ajouté aux articles souscrits
   directement : le besoin réel d'articles à avoir en rayon, comparé au stock.
3. « Lignes souscrites » : une ligne par article ou kit souscrit (tableau Excel filtrable, prêt pour
   Insertion › Tableau croisé dynamique).
Le stock est celui des dépôts où les fournitures seront retirées (ceux des souscriptions exportées).
"""
from collections import defaultdict
from io import BytesIO

from django.db.models import Sum
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

from apps.catalog.models import Article, Kit
from apps.stock.models import StockLevel

from .models import TontineLine

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MONEY = '#,##0" FCFA"'
HEADER_FONT = Font(bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="0B6B2B")
SECTION_FONT = Font(bold=True, size=12, color="0B6B2B")
ALERT_FILL = PatternFill("solid", fgColor="FDECEA")


def _stock_by_article(article_ids, depot_ids) -> dict:
    """Stock disponible (physique − réservé) par article, sur les dépôts concernés."""
    rows = (StockLevel.objects.filter(article_id__in=article_ids, depot_id__in=depot_ids)
            .values("article_id").annotate(quantity=Sum("quantity"), reserved=Sum("reserved")))
    return {row["article_id"]: (row["quantity"] or 0) - (row["reserved"] or 0) for row in rows}


def _header(sheet, row: int, labels: list[str]):
    for column, label in enumerate(labels, start=1):
        cell = sheet.cell(row=row, column=column, value=label)
        cell.font, cell.fill = HEADER_FONT, HEADER_FILL
        cell.alignment = Alignment(vertical="center", wrap_text=True)


def _widths(sheet, widths: list[int]):
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width


def build_workbook(tontines, title: str) -> bytes:
    tontines = list(tontines)
    depot_ids = {t.depot_id for t in tontines}
    lines = list(TontineLine.objects.filter(tontine__in=tontines)
                 .select_related("tontine__school_year", "tontine__depot__library", "article__kit")
                 .order_by("tontine__number", "sort_order"))

    # Quantités souscrites par kit et par article (souscrits directement).
    kits, articles = defaultdict(lambda: [0, set(), 0]), defaultdict(lambda: [0, set(), 0])
    for line in lines:
        bucket = kits if line.article.type == Article.Type.KIT else articles
        entry = bucket[line.article]
        entry[0] += line.quantity
        entry[1].add(line.tontine_id)
        entry[2] += line.quantity * line.unit_price

    # Besoin réel en articles : articles directs + composants des kits virtuels.
    needs = defaultdict(lambda: [0, 0])  # article -> [direct, via kits]
    for article, (quantity, _subs, _amount) in articles.items():
        needs[article][0] += quantity
    for kit_article, (quantity, _subs, _amount) in kits.items():
        kit = kit_article.kit
        if kit.stock_mode == Kit.StockMode.VIRTUAL:
            for component in kit.components.select_related("article").filter(is_optional=False):
                needs[component.article][1] += component.quantity * quantity
    stock = _stock_by_article({a.pk for a in [*kits, *articles, *needs]}, depot_ids)

    workbook = Workbook()

    # 1. TCD kits et articles.
    pivot = workbook.active
    pivot.title = "TCD kits et articles"
    pivot.append([title])
    pivot["A1"].font = Font(bold=True, size=13)
    pivot.append([f"{len(tontines)} souscription(s) · exporté le {timezone.localtime():%d/%m/%Y à %H:%M}"])
    pivot.append([])
    pivot.append(["Kits souscrits"])
    pivot.cell(row=pivot.max_row, column=1).font = SECTION_FONT
    _header(pivot, pivot.max_row + 1, ["Code", "Kit", "Quantité souscrite", "Souscriptions", "Montant souscrit",
                                       "Stock du kit", "À préparer / commander"])
    first = pivot.max_row + 1
    for article, (quantity, subs, amount) in sorted(kits.items(), key=lambda kv: (-kv[1][0], kv[0].name)):
        assembled = article.kit.stock_mode == Kit.StockMode.ASSEMBLED
        row = pivot.max_row + 1
        pivot.append([article.code, article.name, quantity, len(subs), amount,
                      stock.get(article.pk, 0) if assembled else "Kit virtuel : voir « Besoin en articles »",
                      f"=MAX(0,C{row}-F{row})" if assembled else None])
        pivot.cell(row=row, column=5).number_format = MONEY
    if kits:
        last = pivot.max_row
        pivot.append(["Total", None, f"=SUM(C{first}:C{last})", None, f"=SUM(E{first}:E{last})"])
        pivot.cell(row=pivot.max_row, column=5).number_format = MONEY
        pivot.cell(row=pivot.max_row, column=1).font = Font(bold=True)
    else:
        pivot.append(["Aucun kit souscrit."])

    pivot.append([])
    pivot.append(["Articles souscrits (hors kits)"])
    pivot.cell(row=pivot.max_row, column=1).font = SECTION_FONT
    _header(pivot, pivot.max_row + 1, ["Code", "Article", "Quantité souscrite", "Souscriptions", "Montant souscrit",
                                       "Stock disponible", "À commander"])
    first = pivot.max_row + 1
    for article, (quantity, subs, amount) in sorted(articles.items(), key=lambda kv: (-kv[1][0], kv[0].name)):
        row = pivot.max_row + 1
        pivot.append([article.code, article.name, quantity, len(subs), amount, stock.get(article.pk, 0),
                      f"=MAX(0,C{row}-F{row})"])
        pivot.cell(row=row, column=5).number_format = MONEY
    if articles:
        last = pivot.max_row
        pivot.append(["Total", None, f"=SUM(C{first}:C{last})", None, f"=SUM(E{first}:E{last})"])
        pivot.cell(row=pivot.max_row, column=5).number_format = MONEY
        pivot.cell(row=pivot.max_row, column=1).font = Font(bold=True)
    else:
        pivot.append(["Aucun article souscrit hors kits."])
    _widths(pivot, [14, 52, 14, 14, 18, 22, 18])
    pivot.freeze_panes = "A4"

    # 2. Besoin en articles (kits décomposés).
    need_sheet = workbook.create_sheet("Besoin en articles")
    need_sheet.append(["Besoin réel en articles : articles souscrits + contenu des kits virtuels souscrits"])
    need_sheet["A1"].font = Font(bold=True, size=13)
    _header(need_sheet, 2, ["Code", "Article", "Souscrit directement", "Dans les kits", "Besoin total",
                            "Stock disponible", "À commander"])
    for article, (direct, via_kits) in sorted(needs.items(), key=lambda kv: kv[0].name):
        row = need_sheet.max_row + 1
        available = stock.get(article.pk, 0)
        need_sheet.append([article.code, article.name, direct, via_kits, f"=C{row}+D{row}", available,
                           f"=MAX(0,E{row}-F{row})"])
        if available < direct + via_kits:
            for column in range(1, 8):
                need_sheet.cell(row=row, column=column).fill = ALERT_FILL
    if not needs:
        need_sheet.append(["Aucun besoin."])
    _widths(need_sheet, [14, 52, 18, 14, 14, 16, 14])
    need_sheet.freeze_panes = "A3"
    need_sheet.auto_filter.ref = f"A2:G{max(need_sheet.max_row, 2)}"

    # 3. Lignes souscrites (tableau Excel, base d'un TCD).
    detail = workbook.create_sheet("Lignes souscrites")
    labels = ["N° souscription", "Souscripteur", "Téléphone", "Année scolaire", "Statut", "Librairie", "Type",
              "Code", "Désignation", "Quantité", "Prix unitaire", "Montant", "Versé (%)"]
    _header(detail, 1, labels)
    for line in lines:
        tontine = line.tontine
        progress = min(100, tontine.paid_amount * 100 // tontine.target_amount) if tontine.target_amount else 0
        detail.append([tontine.number, tontine.subscriber_name, tontine.subscriber_phone,
                       tontine.school_year.label if tontine.school_year_id else "", tontine.get_status_display(),
                       tontine.depot.library.name if tontine.depot.library_id else "Entrepôt général",
                       "Kit" if line.article.type == Article.Type.KIT else "Article", line.article.code,
                       line.description, line.quantity, line.unit_price, line.quantity * line.unit_price, progress])
        for column in (11, 12):
            detail.cell(row=detail.max_row, column=column).number_format = MONEY
    if lines:
        table = Table(displayName="LignesSouscrites", ref=f"A1:{get_column_letter(len(labels))}{detail.max_row}")
        table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium7", showRowStripes=True)
        detail.add_table(table)
    _widths(detail, [18, 26, 15, 13, 18, 20, 9, 13, 48, 10, 15, 15, 10])
    detail.freeze_panes = "A2"

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def export_filename(school_year_label: str | None) -> str:
    return f"souscriptions-{school_year_label or 'toutes-annees'}-{timezone.localdate():%Y%m%d}.xlsx"
