"""Cloisonnement des données par librairie.

Règles :
- l'administrateur (et tout utilisateur sans librairie) voit toutes les librairies ;
- un employé rattaché à une librairie gère uniquement les dépôts de sa librairie
  (ventes, caisses, pertes, réceptions…) ;
- en lecture du stock, il voit aussi l'entrepôt général (dépôts sans librairie) pour savoir
  ce qu'il peut aller chercher, et toutes les autres librairies s'il a la permission
  « Voir le stock des autres librairies ».

Les fonctions renvoient `None` quand aucun filtre ne s'applique (accès à tout).
"""
from django.db.models import Q

from .models import Depot

VIEW_ALL_STOCK = "stock.view_all_libraries"


def restricted_library(user):
    """Librairie à laquelle l'utilisateur est limité, ou None (accès à toutes)."""
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    return user.restricted_library


def own_depot_ids(user):
    """Dépôts que l'utilisateur peut gérer (écritures, ventes, caisses), ou None (tous)."""
    library = restricted_library(user)
    if library is None:
        return None
    return set(Depot.all_objects.filter(library=library).values_list("pk", flat=True))


def readable_depot_ids(user):
    """Dépôts dont l'utilisateur peut consulter le stock, ou None (tous)."""
    library = restricted_library(user)
    if library is None or user.has_app_perm(VIEW_ALL_STOCK):
        return None
    return set(Depot.all_objects.filter(Q(library=library) | Q(library__isnull=True)).values_list("pk", flat=True))


def filter_by_depots(queryset, depot_ids, field="depot"):
    """Restreint un queryset aux dépôts autorisés (aucun filtre si `depot_ids` vaut None)."""
    if depot_ids is None:
        return queryset
    return queryset.filter(**{f"{field}__in": depot_ids})


def can_manage_depot(user, depot) -> bool:
    ids = own_depot_ids(user)
    return ids is None or (depot is not None and depot.pk in ids)


def can_read_depot(user, depot) -> bool:
    ids = readable_depot_ids(user)
    return ids is None or (depot is not None and depot.pk in ids)
