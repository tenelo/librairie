"""Envoi des rapports planifiés (tâche Celery horaire)."""
import logging
from datetime import datetime, timedelta

from django.conf import settings
from django.core.mail import EmailMessage
from django.utils import timezone

from apps.core.pdf import PdfUnavailable

from . import exports, services
from .models import ScheduledReport

logger = logging.getLogger("librairie.reports")


def period_for(schedule: ScheduledReport, today):
    """Période couverte : la veille, la semaine écoulée (lundi → dimanche) ou le mois écoulé."""
    if schedule.frequency == ScheduledReport.Frequency.DAILY:
        day = today - timedelta(days=1)
        return day, day
    if schedule.frequency == ScheduledReport.Frequency.WEEKLY:
        end = today - timedelta(days=today.weekday() + 1)
        return end - timedelta(days=6), end
    end = today.replace(day=1) - timedelta(days=1)
    return end.replace(day=1), end


def is_due(schedule: ScheduledReport, now: datetime) -> bool:
    local = timezone.localtime(now)
    today = local.date()
    if not schedule.is_active or local.hour < schedule.send_hour:
        return False
    if schedule.frequency == ScheduledReport.Frequency.WEEKLY and today.weekday() != 0:
        return False
    if schedule.frequency == ScheduledReport.Frequency.MONTHLY and today.day != 1:
        return False
    return schedule.last_sent_at is None or timezone.localtime(schedule.last_sent_at).date() < today


def send(schedule: ScheduledReport, now=None) -> None:
    now = now or timezone.now()
    date_from, date_to = period_for(schedule, timezone.localtime(now).date())
    params = {**schedule.filters, "date_from": date_from.isoformat(), "date_to": date_to.isoformat()}
    data = services.build(schedule.report, params)
    message = EmailMessage(
        subject=f"{schedule.name} — du {date_from:%d/%m/%Y} au {date_to:%d/%m/%Y}",
        body="\n".join([f"{data['title']} ({data['period']['depot_name']})", ""]
                       + [f"- {item['label']} : {item['value']}" for item in data["summary"]]
                       + ["", "Le détail figure dans le fichier joint."]),
        from_email=settings.DEFAULT_FROM_EMAIL, to=schedule.recipients)
    message.attach(exports.filename(data, "xlsx"), exports.to_xlsx(data), exports.XLSX)
    try:
        message.attach(exports.filename(data, "pdf"), exports.to_pdf(data), "application/pdf")
    except PdfUnavailable:
        pass
    message.send(fail_silently=False)


def send_due(now=None) -> int:
    now = now or timezone.now()
    sent = 0
    for schedule in ScheduledReport.objects.filter(is_active=True):
        if not is_due(schedule, now):
            continue
        try:
            send(schedule, now)
            schedule.last_sent_at, schedule.last_error = now, ""
            sent += 1
        except Exception as exc:  # noqa: BLE001 — un rapport en erreur n'empêche pas les autres
            logger.exception("Rapport planifié %s en échec", schedule.pk)
            schedule.last_error = str(exc)[:255]
            schedule.last_sent_at = now  # pas de nouvelle tentative avant la prochaine échéance
        schedule.save(update_fields=["last_sent_at", "last_error"])
    return sent
