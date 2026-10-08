from celery import shared_task


@shared_task(autoretry_for=(ConnectionError,), retry_backoff=True, max_retries=3)
def deliver_notification(notification_id, channels):
    """Diffusion d'une notification sur ses canaux (WebSocket, Web Push, e-mail, SMS)."""
    from .services import deliver

    return deliver(notification_id, channels)
