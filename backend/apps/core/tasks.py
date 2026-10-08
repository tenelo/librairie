from celery import shared_task
from django.utils import timezone


@shared_task
def ping():
    """Tâche de diagnostic : vérifie que le worker Celery répond."""
    return timezone.now().isoformat()
