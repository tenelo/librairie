"""Registres de la synchronisation.

- PUSH : (entité, opération) → gestionnaire qui applique une opération venue d'un terminal.
  Chaque application métier enregistre ses gestionnaires dans son `apps.py` (méthode `ready`).
- PULL : entité → (queryset de base, fonction de sérialisation) des données descendues vers les terminaux.

Un gestionnaire reçoit un `SyncContext` et le `payload` ; il renvoie un dict (résultat) ou lève :
- `rest_framework.exceptions.ValidationError` → statut « error » (définitif, visible dans la file) ;
- `SyncConflictError` → statut « conflict » avec la version serveur.
"""
from dataclasses import dataclass
from typing import Callable

PUSH_HANDLERS: dict = {}
PULL_SOURCES: dict = {}


@dataclass
class SyncContext:
    user: object
    device: object
    client_timestamp: object
    operation_id: object
    request: object = None


class SyncConflictError(Exception):
    def __init__(self, server_version: dict, message="La donnée a été modifiée sur le serveur."):
        super().__init__(message)
        self.server_version = server_version


def register_push(entity: str, operation: str, permission: str | None = None):
    """Décorateur : enregistre un gestionnaire d'opération (avec la permission applicative exigée)."""

    def decorator(func: Callable):
        PUSH_HANDLERS[(entity, operation)] = (func, permission)
        return func

    return decorator


def register_pull(entity: str, queryset_factory: Callable, serialize: Callable, permission: str | None = None):
    """Enregistre une source de données descendante.

    `queryset_factory()` doit renvoyer un queryset incluant les suppressions logiques
    (manager `all_objects`) pour que les terminaux les reçoivent.
    """
    PULL_SOURCES[entity] = (queryset_factory, serialize, permission)
