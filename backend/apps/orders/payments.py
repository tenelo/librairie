"""Paiement en ligne d'un acompte (Mobile Money).

`PaymentProvider` est l'interface à implémenter pour brancher un agrégateur réel (CinetPay,
PayDunya, Orange Money Web Payment…) : `initiate` démarre la transaction chez le prestataire,
`parse_webhook` traduit sa notification de résultat. L'implémentation fournie, `SandboxProvider`,
simule ces échanges sans appel réseau : la transaction reste « en attente » jusqu'à la simulation
du résultat (bouton de la boutique en mode démonstration, ou appel du webhook).
"""
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass

from django.conf import settings
from django.utils.module_loading import import_string

OPERATORS = {
    "ORANGE_MONEY": "Orange Money",
    "MTN_MOMO": "MTN MoMo",
    "MOOV_MONEY": "Moov Money",
    "WAVE": "Wave",
}


@dataclass
class InitiationResult:
    external_ref: str
    instructions: str
    redirect_url: str = ""
    raw: dict | None = None


@dataclass
class WebhookResult:
    external_ref: str
    succeeded: bool
    message: str = ""
    raw: dict | None = None


class PaymentProvider(ABC):
    code = "abstract"
    label = "Prestataire"
    is_sandbox = False

    @abstractmethod
    def initiate(self, *, order, amount: int, phone: str, operator: str) -> InitiationResult:
        """Démarre une demande de paiement ; ne doit jamais considérer le paiement comme acquis."""

    @abstractmethod
    def parse_webhook(self, data: dict, headers: dict) -> WebhookResult:
        """Vérifie (signature) et traduit la notification de résultat envoyée par le prestataire."""


class SandboxProvider(PaymentProvider):
    """Prestataire fictif pour les tests et la démonstration (aucun débit réel)."""

    code = "sandbox"
    label = "Simulation Mobile Money"
    is_sandbox = True

    def initiate(self, *, order, amount, phone, operator):
        reference = f"SBX-{uuid.uuid4().hex[:12].upper()}"
        operator_label = OPERATORS.get(operator, operator)
        return InitiationResult(
            external_ref=reference,
            instructions=(f"Simulation : une demande de {amount} FCFA a été envoyée au {phone} ({operator_label}). "
                          "Validez-la sur le téléphone puis confirmez ici."),
            raw={"sandbox": True},
        )

    def parse_webhook(self, data, headers):
        return WebhookResult(external_ref=str(data.get("reference", "")),
                             succeeded=str(data.get("status", "")).upper() in ("SUCCESS", "SUCCEEDED", "OK"),
                             message=str(data.get("message", ""))[:255], raw=data)


def get_provider() -> PaymentProvider:
    return import_string(getattr(settings, "PAYMENT_PROVIDER", "apps.orders.payments.SandboxProvider"))()
