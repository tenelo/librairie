from celery import shared_task

from .services import refresh_all_alerts


@shared_task
def refresh_stock_alerts():
    """Recalcul périodique des alertes de stock bas / rupture (voir CELERY_BEAT_SCHEDULE)."""
    return refresh_all_alerts()
