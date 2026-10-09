from celery import shared_task

from . import scheduling


@shared_task
def send_scheduled_reports():
    """Envoie les rapports planifiés arrivés à échéance (exécutée toutes les heures)."""
    return scheduling.send_due()
