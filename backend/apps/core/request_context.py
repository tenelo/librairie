"""Informations de contexte extraites d'une requête (terminal, IP, date client)."""
from django.utils.dateparse import parse_datetime

DEVICE_HEADER = "HTTP_X_DEVICE_CODE"
CLIENT_TIMESTAMP_HEADER = "HTTP_X_CLIENT_TIMESTAMP"


def get_client_ip(request):
    if request is None:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def get_request_device(request):
    """Retourne le terminal actif désigné par l'en-tête `X-Device-Code`, ou None."""
    if request is None:
        return None
    code = (request.META.get(DEVICE_HEADER) or "").strip().upper()
    if not code:
        return None
    from apps.accounts.models import Device

    return Device.objects.filter(code=code, is_active=True).first()


def get_client_timestamp(request):
    if request is None:
        return None
    raw = request.META.get(CLIENT_TIMESTAMP_HEADER)
    return parse_datetime(raw) if raw else None
