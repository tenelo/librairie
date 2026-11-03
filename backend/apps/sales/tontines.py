"""Tontine scolaire : paiement des fournitures en plusieurs versements, puis remise à la caisse.

Le nom affiché (« Tontine scolaire ») se change à un seul endroit : `TONTINE_LABEL` ci-dessous,
`TONTINE_LABEL` dans `frontend/backoffice/src/app/features.ts`, et le libellé du moyen
de paiement dans Administration › Moyens de paiement.

Déroulement :
1. Souscription : nom et prénoms du souscripteur, téléphone et articles souscrits (kits, livres,
   cahiers…) au prix du jour, figés. Nom et téléphone restent modifiables ensuite.
2. Versements : chaque versement (espèces, Mobile Money, carte) est encaissé sur la caisse ouverte
   et donne un reçu. On ne peut pas verser plus que le reste à payer.
3. Remise : à la caisse, la tontine est chargée (liste et prix figés) ; le total versé s'impute
   avec le moyen de paiement « Tontine scolaire », le reste éventuel se paie normalement.
   Le chiffre d'affaires et la sortie de stock sont comptés à ce moment-là.
4. Annulation (avant la remise) : le souscripteur est remboursé de ce qu'il a versé.
"""
from django.db import transaction
from django.db.models import Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.catalog.models import Article, SchoolYear
from apps.core.numbering import next_document_number
from apps.core.permissions import HasAppPermission, IsStaffMember
from apps.core.request_context import get_request_device
from apps.stock.models import Depot
from apps.stock.scoping import can_manage_depot, filter_by_depots, own_depot_ids

from .models import CashSession, PaymentMethod, Tontine, TontineLine, TontinePayment
from .tontines_export import XLSX, build_workbook, export_filename

TONTINE_LABEL = "Tontine scolaire"
# Voir les souscriptions de toutes les librairies (en lecture) : administrateur et personnes désignées.
VIEW_ALL = "tontines.view_all"
CLOSED = "les fournitures sont déjà remises ou la souscription est annulée"


def _name(tontine) -> str:
    """« tontine scolaire TS-2026-00001 », pour les messages."""
    return f"{TONTINE_LABEL.lower()} {tontine.number}"

# Moyens acceptés pour un versement (les autres — crédit, bon, avoir… — n'apportent pas d'argent).
PAYABLE_KINDS = (PaymentMethod.Kind.CASH, PaymentMethod.Kind.MOBILE_MONEY, PaymentMethod.Kind.CARD)


# --- Règles -------------------------------------------------------------------------------------


def _session_for(method, session_id, user):
    """Session de caisse du versement : obligatoire pour les espèces, ouverte, de sa librairie."""
    session = CashSession.objects.filter(pk=session_id).select_related("depot").first() if session_id else None
    if session_id and session is None:
        raise ValidationError({"cash_session": "Session de caisse inconnue."})
    if session is not None:
        if session.status != CashSession.Status.OPEN:
            raise ValidationError({"cash_session": "La caisse est clôturée."})
        if not can_manage_depot(user, session.depot):
            raise ValidationError({"cash_session": "Cette caisse appartient à une autre librairie."})
    if session is None and method.kind == PaymentMethod.Kind.CASH:
        raise ValidationError({"cash_session": "Un versement en espèces exige une caisse ouverte sur ce poste."})
    return session


def _method(code):
    method = PaymentMethod.objects.filter(code=code or "CASH", is_active=True).first()
    if method is None or method.kind not in PAYABLE_KINDS:
        raise ValidationError({"method": f"Moyen de paiement non accepté pour la {TONTINE_LABEL.lower()}."})
    return method


def _default_depot(user, device):
    """Dépôt de remise par défaut : celui du terminal, sinon le dépôt principal de sa librairie."""
    if device is not None and device.depot_id and can_manage_depot(user, device.depot):
        return device.depot
    depots = filter_by_depots(Depot.objects.filter(is_active=True), own_depot_ids(user), field="pk")
    depot = depots.order_by("-is_default", "code").first()
    if depot is None:
        raise ValidationError({"depot": "Aucun dépôt disponible pour la remise des fournitures."})
    return depot


@transaction.atomic
def create_tontine(user, data, device=None) -> Tontine:
    from .services import catalog_unit_price

    depot = data.get("depot") or _default_depot(user, device)
    if not can_manage_depot(user, depot):
        raise ValidationError({"depot": "Ce dépôt appartient à une autre librairie."})
    now = timezone.now()
    lines = []
    for index, line in enumerate(data.get("lines") or []):
        article, quantity = line["article"], line["quantity"]
        if not article.is_active:
            raise ValidationError({"lines": f"Ligne {index + 1} : l'article {article.name} est désactivé."})
        price, _kind = catalog_unit_price(article, 1, now, depot.library)
        lines.append((article, quantity, price))
    target = sum(quantity * price for _article, quantity, price in lines)
    if target <= 0:
        raise ValidationError({"lines": "Ajoutez au moins un article à la souscription."})
    tontine = Tontine.objects.create(
        number=next_document_number("TS"), subscriber_name=data["subscriber_name"].strip(),
        subscriber_phone=(data.get("subscriber_phone") or "").strip(), depot=depot, target_amount=target,
        school_year=data.get("school_year") or SchoolYear.current(), created_by=user, device=device,
    )
    for order, (article, quantity, price) in enumerate(lines):
        TontineLine.objects.create(tontine=tontine, article=article, description=article.name[:200],
                                   quantity=quantity, unit_price=price, sort_order=order, device=device)
    log_event(AuditLog.Action.CREATE, user=user, device=device, entity="Tontine", entity_id=tontine.pk,
              description=f"{TONTINE_LABEL} {tontine.number} : {tontine.subscriber_name}, {target} FCFA")
    return tontine


@transaction.atomic
def record_payment(user, tontine_id, data, device=None) -> TontinePayment:
    tontine = Tontine.objects.select_for_update().get(pk=tontine_id)
    if tontine.status != Tontine.Status.OPEN:
        raise ValidationError({"detail": f"La {_name(tontine)} est {tontine.get_status_display().lower()}."})
    amount = data["amount"]
    if amount <= 0:
        raise ValidationError({"amount": "Montant invalide."})
    if amount > tontine.remaining:
        raise ValidationError({"amount": f"Le versement dépasse le reste à payer ({tontine.remaining} FCFA)."})
    method = _method(data.get("method"))
    reference = (data.get("reference") or "").strip()
    if method.requires_reference and not reference:
        raise ValidationError({"reference": f"Référence de transaction obligatoire pour {method.label}."})
    session = _session_for(method, data.get("cash_session"), user)
    count = TontinePayment.all_objects.filter(tontine=tontine).count()
    payment = TontinePayment.objects.create(
        number=f"{tontine.number}-V{count + 1:02d}", tontine=tontine, kind=TontinePayment.Kind.PAYMENT,
        amount=amount, method=method, reference=reference[:60], cash_session=session, user=user,
        paid_at=timezone.now(), device=device,
    )
    tontine.paid_amount += amount
    tontine.save(update_fields=["paid_amount"])
    log_event(AuditLog.Action.CREATE, user=user, device=device, entity="TontinePayment", entity_id=payment.pk,
              description=f"Versement {payment.number} : {amount} FCFA ({method.label})")
    return payment


@transaction.atomic
def cancel_tontine(user, tontine_id, data, device=None) -> Tontine:
    tontine = Tontine.objects.select_for_update().get(pk=tontine_id)
    if tontine.status != Tontine.Status.OPEN:
        raise ValidationError({"detail": f"Annulation impossible : {CLOSED}."})
    reason = (data.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "Le motif d'annulation est obligatoire."})
    refund = tontine.available
    if refund > 0:
        method = _method(data.get("method"))
        session = _session_for(method, data.get("cash_session"), user)
        count = TontinePayment.all_objects.filter(tontine=tontine).count()
        TontinePayment.objects.create(
            number=f"{tontine.number}-R{count + 1:02d}", tontine=tontine, kind=TontinePayment.Kind.REFUND,
            amount=-refund, method=method, reference=(data.get("reference") or "")[:60], cash_session=session,
            user=user, paid_at=timezone.now(), device=device,
        )
        tontine.paid_amount -= refund
    tontine.status = Tontine.Status.CANCELLED
    tontine.cancelled_at = timezone.now()
    tontine.cancelled_by = user
    tontine.cancel_reason = reason[:150]
    tontine.save(update_fields=["paid_amount", "status", "cancelled_at", "cancelled_by", "cancel_reason"])
    log_event(AuditLog.Action.CANCEL, user=user, device=device, entity="Tontine", entity_id=tontine.pk,
              description=f"Annulation de la {_name(tontine)} ({reason}), remboursement {refund} FCFA")
    return tontine


def tontine_for_sale(tontine_id, depot) -> Tontine:
    """Tontine retirée par une vente (contrôlée avant l'enregistrement de la vente)."""
    tontine = Tontine.objects.select_for_update().select_related("depot").filter(pk=tontine_id).first()
    if tontine is None:
        raise ValidationError({"tontine": f"{TONTINE_LABEL} inconnue."})
    if tontine.status != Tontine.Status.OPEN:
        raise ValidationError({"tontine": f"La {_name(tontine)} est {tontine.get_status_display().lower()}."})
    if tontine.depot.library_id != depot.library_id:
        raise ValidationError({"tontine": f"La {_name(tontine)} se retire à {tontine.depot.name}."})
    return tontine


def complete_tontine(tontine: Tontine, sale, used: int, user):
    tontine.used_amount += used
    tontine.status = Tontine.Status.DELIVERED
    tontine.sale = sale
    tontine.delivered_at = sale.sold_at
    tontine.delivered_by = user
    tontine.save(update_fields=["used_amount", "status", "sale", "delivered_at", "delivered_by"])
    log_event(AuditLog.Action.UPDATE, user=user, device=sale.device, entity="Tontine", entity_id=tontine.pk,
              description=f"Fournitures de la {_name(tontine)} remises (vente {sale.receipt_number}, "
                          f"{used} FCFA imputés)")


# --- API ----------------------------------------------------------------------------------------


class TontineLineSerializer(serializers.ModelSerializer):
    article_code = serializers.CharField(source="article.code", read_only=True)
    line_total = serializers.SerializerMethodField()

    class Meta:
        model = TontineLine
        fields = ["id", "article", "article_code", "description", "quantity", "unit_price", "line_total"]

    def get_line_total(self, obj) -> int:
        return obj.quantity * obj.unit_price


class TontinePaymentSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    method_code = serializers.CharField(source="method.code", read_only=True)
    method_label = serializers.CharField(source="method.label", read_only=True)
    user_name = serializers.CharField(source="user.get_full_name", read_only=True)

    class Meta:
        model = TontinePayment
        fields = ["id", "number", "kind", "kind_label", "amount", "method_code", "method_label", "reference",
                  "cash_session", "user_name", "paid_at"]


class TontineSerializer(serializers.ModelSerializer):
    depot_name = serializers.CharField(source="depot.name", read_only=True)
    library = serializers.UUIDField(source="depot.library_id", read_only=True, allow_null=True)
    library_name = serializers.CharField(source="depot.library.name", read_only=True, default=None)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True)
    school_year_label = serializers.CharField(source="school_year.label", read_only=True, default=None)
    delivered_by_name = serializers.CharField(source="delivered_by.get_full_name", read_only=True, default=None)
    cancelled_by_name = serializers.CharField(source="cancelled_by.get_full_name", read_only=True, default=None)
    sale_receipt = serializers.CharField(source="sale.receipt_number", read_only=True, default=None)
    available = serializers.IntegerField(read_only=True)
    remaining = serializers.IntegerField(read_only=True)
    progress = serializers.SerializerMethodField()
    lines = TontineLineSerializer(many=True, read_only=True)
    payments = TontinePaymentSerializer(many=True, read_only=True)

    class Meta:
        model = Tontine
        fields = ["id", "number", "subscriber_name", "subscriber_phone", "depot", "depot_name", "library",
                  "library_name", "target_amount", "paid_amount", "used_amount", "available", "remaining", "progress",
                  "status", "status_label", "notes", "created_by_name", "created_at", "school_year",
                  "school_year_label", "sale", "sale_receipt", "delivered_at", "delivered_by_name", "cancelled_at",
                  "cancelled_by_name", "cancel_reason", "lines", "payments"]
        read_only_fields = fields

    def get_progress(self, obj) -> int:
        """Part du montant prévu déjà versée, en pourcentage (0 à 100)."""
        if not obj.target_amount:
            return 0
        return min(100, obj.paid_amount * 100 // obj.target_amount)


class TontineLineInputSerializer(serializers.Serializer):
    article = serializers.PrimaryKeyRelatedField(queryset=Article.objects.all())
    quantity = serializers.IntegerField(min_value=1, max_value=10000)


class TontineCreateSerializer(serializers.Serializer):
    subscriber_name = serializers.CharField(max_length=150)
    subscriber_phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    school_year = serializers.PrimaryKeyRelatedField(queryset=SchoolYear.objects.all(), required=False,
                                                     allow_null=True)
    depot = serializers.PrimaryKeyRelatedField(queryset=Depot.objects.all(), required=False, allow_null=True)
    lines = TontineLineInputSerializer(many=True, allow_empty=False)


class TontineUpdateSerializer(serializers.Serializer):
    """Nom et téléphone du souscripteur restent modifiables (la souscription, elle, est figée)."""

    subscriber_name = serializers.CharField(max_length=150, required=False)
    subscriber_phone = serializers.CharField(max_length=20, required=False, allow_blank=True)


class TontinePayInputSerializer(serializers.Serializer):
    amount = serializers.IntegerField()
    method = serializers.CharField(max_length=20, required=False, default="CASH")
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True)
    cash_session = serializers.UUIDField(required=False, allow_null=True)


class TontineCancelInputSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=150)
    method = serializers.CharField(max_length=20, required=False, default="CASH")
    reference = serializers.CharField(max_length=60, required=False, allow_blank=True)
    cash_session = serializers.UUIDField(required=False, allow_null=True)


class TontineViewSet(mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.ReadOnlyModelViewSet):
    """Tontines scolaires, par librairie.

    Un employé voit et gère les souscriptions de sa librairie ; avec « Voir les souscriptions de
    toutes les librairies », il les consulte toutes, mais ne gère toujours que celles de la sienne.
    L'administrateur voit et gère tout.
    """

    serializer_class = TontineSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "tontines.view", "write": "tontines.manage", "cancel": "tontines.cancel"}
    filterset_fields = ["status", "depot", "depot__library", "school_year"]
    search_fields = ["number", "subscriber_name", "subscriber_phone"]
    ordering_fields = ["created_at", "paid_amount", "target_amount"]

    def get_queryset(self):
        queryset = Tontine.objects.select_related("depot__library", "created_by", "sale", "school_year",
                                                  "delivered_by", "cancelled_by") \
            .prefetch_related("lines__article", "payments__method", "payments__user")
        user = self.request.user
        if user.has_app_perm(VIEW_ALL):
            return queryset
        return filter_by_depots(queryset, own_depot_ids(user))

    def _managed_object(self):
        """Souscription à modifier : uniquement celles de sa librairie."""
        tontine = self.get_object()
        if not can_manage_depot(self.request.user, tontine.depot):
            raise PermissionDenied("Cette souscription appartient à une autre librairie : consultation seulement.")
        return tontine

    def _detail(self, tontine, code=status.HTTP_200_OK):
        return Response(TontineSerializer(self.get_queryset().get(pk=tontine.pk)).data, status=code)

    @extend_schema(request=TontineCreateSerializer, responses=TontineSerializer)
    def create(self, request, *args, **kwargs):
        data = TontineCreateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        tontine = create_tontine(request.user, data.validated_data, get_request_device(request))
        return self._detail(tontine, status.HTTP_201_CREATED)

    @extend_schema(request=TontineUpdateSerializer, responses=TontineSerializer)
    def update(self, request, *args, **kwargs):
        tontine = self._managed_object()
        data = TontineUpdateSerializer(data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        if tontine.status != Tontine.Status.OPEN:
            raise ValidationError({"detail": f"Modification impossible : {CLOSED}."})
        old = {field: str(getattr(tontine, field) or "") for field in data.validated_data}
        for field, value in data.validated_data.items():
            setattr(tontine, field, value)
        tontine.save()
        new = {field: str(value or "") for field, value in data.validated_data.items()}
        changes = ", ".join(f"{old[f]} → {new[f]}" for f in new if old[f] != new[f]) or "aucun changement"
        log_event(AuditLog.Action.UPDATE, request=request, entity="Tontine", entity_id=tontine.pk,
                  description=f"Souscripteur modifié : {changes}"[:255], old_values=old, new_values=new)
        return self._detail(tontine)

    @extend_schema(request=TontinePayInputSerializer, responses=TontinePaymentSerializer)
    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """Encaisse un versement et renvoie son reçu."""
        tontine = self._managed_object()
        data = TontinePayInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        payment = record_payment(request.user, tontine.pk, data.validated_data, get_request_device(request))
        return Response(TontinePaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=TontineCancelInputSerializer, responses=TontineSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Annule la tontine et rembourse au client le montant versé."""
        tontine = self._managed_object()
        data = TontineCancelInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        cancel_tontine(request.user, tontine.pk, data.validated_data, get_request_device(request))
        return self._detail(tontine)

    @extend_schema(responses=serializers.DictField())
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Récapitulatif des souscriptions affichées (mêmes filtres que la liste) et kits souscrits."""
        queryset = self.filter_queryset(self.get_queryset())
        totals = queryset.aggregate(expected=Sum("target_amount"), received=Sum("paid_amount"))
        subscribers = queryset.values("subscriber_name", "subscriber_phone").distinct().count()
        kits = (TontineLine.objects.filter(tontine__in=queryset, article__type=Article.Type.KIT)
                .values("article__name").annotate(quantity=Sum("quantity")).order_by("-quantity", "article__name")[:10])
        return Response({
            "subscribers_count": subscribers, "subscriptions_count": queryset.count(),
            "expected_total": totals["expected"] or 0, "received_total": totals["received"] or 0,
            "kits": [{"label": row["article__name"], "quantity": row["quantity"]} for row in kits],
        })

    @extend_schema(responses=serializers.ListField(child=serializers.DictField()))
    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """Traçabilité : chaque action sur la souscription (création, versements, modifications, remise,
        annulation), avec sa date et son auteur, d'après le journal d'audit."""
        tontine = self.get_object()
        payment_ids = [str(pk) for pk in tontine.payments.values_list("pk", flat=True)]
        entries = AuditLog.objects.filter(
            Q(entity="Tontine", entity_id=str(tontine.pk)) | Q(entity="TontinePayment", entity_id__in=payment_ids)
        ).select_related("user").order_by("server_timestamp")
        return Response([{
            "date": entry.client_timestamp or entry.server_timestamp, "action": entry.get_action_display(),
            "user": entry.user.get_full_name() if entry.user_id else entry.username, "description": entry.description,
        } for entry in entries])

    @extend_schema(responses={(200, XLSX): bytes})
    @action(detail=False, methods=["get"])
    def export(self, request):
        """Fichier Excel des kits et articles souscrits (mêmes filtres que la liste) : quantités par kit et
        par article, besoin réel en articles et stock disponible, pour s'approvisionner à temps."""
        queryset = self.filter_queryset(self.get_queryset())
        year = SchoolYear.objects.filter(pk=request.query_params.get("school_year")).first() \
            if request.query_params.get("school_year") else None
        status_label = dict(Tontine.Status.choices).get(request.query_params.get("status", ""), "tous statuts")
        title = f"{TONTINE_LABEL} — {year.label if year else 'toutes les années'} — {status_label.lower()}"
        response = HttpResponse(build_workbook(queryset, title), content_type=XLSX)
        response["Content-Disposition"] = f'attachment; filename="{export_filename(year.label if year else None)}"'
        return response
