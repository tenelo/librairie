"""Application Celery (notifications, expirations, rapports planifiés, alertes de stock)."""
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("librairie")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
