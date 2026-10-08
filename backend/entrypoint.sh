#!/bin/sh
# Point d'entrée des conteneurs backend : web (HTTP + WebSocket), worker et beat Celery.
set -e

role="${1:-web}"

case "$role" in
  web)
    python manage.py migrate --noinput
    python manage.py collectstatic --noinput
    if [ -n "$ADMIN_PASSWORD" ]; then
      python manage.py ensure_admin
    fi
    # Gunicorn pilote des workers Uvicorn : l'application ASGI sert HTTP et WebSocket (Channels).
    exec gunicorn config.asgi:application \
      --worker-class uvicorn_worker.UvicornWorker \
      --bind 0.0.0.0:8000 \
      --workers "${WEB_CONCURRENCY:-3}" \
      --timeout 60 \
      --access-logfile -
    ;;
  worker)
    exec celery -A config worker --loglevel "${CELERY_LOG_LEVEL:-info}"
    ;;
  beat)
    exec celery -A config beat --loglevel "${CELERY_LOG_LEVEL:-info}" \
      --schedule /tmp/celerybeat-schedule
    ;;
  *)
    exec "$@"
    ;;
esac
