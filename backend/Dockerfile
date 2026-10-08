FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=config.settings.prod

# Bibliothèques système : client PostgreSQL et dépendances de WeasyPrint (Pango, polices).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5 libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 \
        fonts-dejavu-core curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN chmod +x entrypoint.sh \
    && useradd --create-home --uid 1000 librairie \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R librairie:librairie /app

USER librairie

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["web"]
