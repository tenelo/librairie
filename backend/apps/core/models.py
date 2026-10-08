"""Modèle de base des entités synchronisables entre le serveur et les terminaux hors connexion."""
import uuid

from django.db import models, transaction
from django.db.models import F
from django.utils import timezone


class SyncCounter(models.Model):
    """Compteur global et monotone qui alimente `sync_version`.

    Un compteur unique (et non un compteur par table) permet au endpoint `sync/pull`
    d'utiliser un seul curseur pour toutes les entités : le client demande « tout ce
    qui a changé depuis la version N » sans risque de manquer une modification.
    """

    name = models.CharField(max_length=50, unique=True)
    value = models.BigIntegerField(default=0)

    class Meta:
        verbose_name = "compteur de synchronisation"

    def __str__(self):
        return f"{self.name}={self.value}"


GLOBAL_COUNTER = "global"


def next_sync_version() -> int:
    """Réserve atomiquement la prochaine version de synchronisation.

    L'incrément se fait par une requête UPDATE ... SET value = value + 1 qui pose un
    verrou de ligne : deux écritures concurrentes obtiennent toujours deux versions
    distinctes et croissantes.
    """
    with transaction.atomic():
        updated = SyncCounter.objects.filter(name=GLOBAL_COUNTER).update(value=F("value") + 1)
        if not updated:
            SyncCounter.objects.get_or_create(name=GLOBAL_COUNTER, defaults={"value": 0})
            SyncCounter.objects.filter(name=GLOBAL_COUNTER).update(value=F("value") + 1)
        return SyncCounter.objects.get(name=GLOBAL_COUNTER).value


def current_sync_version() -> int:
    counter = SyncCounter.objects.filter(name=GLOBAL_COUNTER).first()
    return counter.value if counter else 0


class AliveManager(models.Manager):
    """Manager par défaut : masque les enregistrements supprimés logiquement."""

    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class SyncModel(models.Model):
    """Base abstraite de tous les modèles métiers synchronisables.

    - `id` est un UUID v4 qui peut être généré par le terminal (création hors ligne) ;
      le serveur conserve l'identifiant reçu, ce qui rend la synchronisation idempotente.
    - `sync_version` est réattribuée à chaque écriture et sert de curseur au `sync/pull`.
    - Les suppressions sont logiques (`is_deleted`) afin d'être propagées aux terminaux.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField("créé le", default=timezone.now, editable=False)
    updated_at = models.DateTimeField("modifié le", auto_now=True)
    sync_version = models.BigIntegerField("version de synchronisation", default=0, db_index=True, editable=False)
    is_deleted = models.BooleanField("supprimé", default=False, db_index=True)
    device = models.ForeignKey(
        "accounts.Device",
        verbose_name="terminal d'origine",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    client_timestamp = models.DateTimeField("date client", null=True, blank=True)

    objects = AliveManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True
        base_manager_name = "all_objects"
        default_manager_name = "objects"

    def save(self, *args, **kwargs):
        self.sync_version = next_sync_version()
        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            kwargs["update_fields"] = set(update_fields) | {"sync_version", "updated_at"}
        super().save(*args, **kwargs)

    def soft_delete(self):
        """Suppression logique : l'enregistrement reste en base et sera propagé aux terminaux."""
        self.is_deleted = True
        self.save(update_fields=["is_deleted"])

    def delete(self, using=None, keep_parents=False):
        self.soft_delete()
        return (0, {})

    def hard_delete(self):
        """Suppression physique, réservée aux tests et aux données non métiers."""
        return super().delete()
