"""Journalisation automatique des écritures faites par les ViewSets métier."""
from apps.audit.models import AuditLog
from apps.audit.services import diff_values, log_event

TECHNICAL_FIELDS = {"sync_version", "updated_at", "created_at"}


class AuditedViewSetMixin:
    """Ajoute au journal d'audit chaque création, modification et suppression (logique).

    Les valeurs comparées sont celles du serializer de la vue : le journal contient donc
    le diff tel que l'utilisateur le voit (anciennes / nouvelles valeurs).
    """

    audit_entity = ""

    def _audit_snapshot(self, instance):
        data = dict(self.get_serializer(instance).data)
        for field in TECHNICAL_FIELDS:
            data.pop(field, None)
        return data

    def _audit_label(self, instance):
        return str(instance)[:200]

    def perform_create(self, serializer):
        instance = serializer.save()
        log_event(
            AuditLog.Action.CREATE,
            request=self.request,
            entity=self.audit_entity or instance.__class__.__name__,
            entity_id=instance.pk,
            description=f"Création : {self._audit_label(instance)}",
            new_values=self._audit_snapshot(instance),
        )

    def perform_update(self, serializer):
        before = self._audit_snapshot(serializer.instance)
        instance = serializer.save()
        old, new = diff_values(before, self._audit_snapshot(instance))
        if old or new:
            log_event(
                AuditLog.Action.UPDATE,
                request=self.request,
                entity=self.audit_entity or instance.__class__.__name__,
                entity_id=instance.pk,
                description=f"Modification : {self._audit_label(instance)}",
                old_values=old,
                new_values=new,
            )

    def perform_destroy(self, instance):
        label = self._audit_label(instance)
        instance.soft_delete()
        log_event(
            AuditLog.Action.DELETE,
            request=self.request,
            entity=self.audit_entity or instance.__class__.__name__,
            entity_id=instance.pk,
            description=f"Suppression : {label}",
        )
