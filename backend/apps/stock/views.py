import django_filters
from django.db.models import Case, Count, F, IntegerField, Q, Sum, Value, When
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import generics, mixins, serializers, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.mixins import AuditedViewSetMixin
from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.catalog.models import Article, Kit
from apps.core.permissions import HasAppPermission, IsStaffMember

from . import services
from .models import Depot, KitAssembly, Library, Location, StockAlert, StockLevel, StockMovement, StockTransfer
from .scoping import can_manage_depot, can_read_depot, filter_by_depots, readable_depot_ids
from .serializers import (
    AdjustmentSerializer,
    DepotSerializer,
    KitAssemblySerializer,
    LibrarySerializer,
    LocationSerializer,
    StockAlertSerializer,
    StockCardLineSerializer,
    StockLevelSerializer,
    StockMovementSerializer,
    StockStateSerializer,
    StockTransferSerializer,
)


class LibraryViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    """Librairies du propriétaire (Administration › Librairies) : libellé et quartier / commune."""

    serializer_class = LibrarySerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "settings.manage"}
    pagination_class = None
    search_fields = ["name", "location"]
    audit_entity = "Library"

    def get_queryset(self):
        return Library.objects.annotate(
            depot_count=Count("depots", filter=Q(depots__is_deleted=False), distinct=True),
            user_count=Count("users", distinct=True),
        )

    def destroy(self, request, *args, **kwargs):
        library = self.get_object()
        if library.depots.exists() or library.users.exists():
            return Response({"detail": "Cette librairie a des dépôts ou des utilisateurs : désactivez-la plutôt."},
                            status=400)
        return super().destroy(request, *args, **kwargs)


class DepotViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = Depot.objects.select_related("library")
    serializer_class = DepotSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "settings.manage"}
    pagination_class = None
    filterset_fields = ["library", "is_active"]
    audit_entity = "Depot"

    def destroy(self, request, *args, **kwargs):
        depot = self.get_object()
        if StockMovement.objects.filter(depot=depot).exists():
            return Response({"detail": "Ce dépôt a des mouvements de stock : désactivez-le plutôt."}, status=400)
        return super().destroy(request, *args, **kwargs)


class LocationViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = Location.objects.select_related("depot")
    serializer_class = LocationSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "stock.view", "write": "stock.manage"}
    pagination_class = None
    filterset_fields = ["depot"]
    audit_entity = "Location"


class StockLevelViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Niveaux par article et dépôt ; seul l'emplacement est modifiable (les quantités suivent le journal)."""

    serializer_class = StockLevelSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "stock.view", "write": "stock.manage"}
    filterset_fields = ["article", "depot"]
    pagination_class = None

    def get_queryset(self):
        queryset = StockLevel.objects.select_related("depot", "location")
        return filter_by_depots(queryset, readable_depot_ids(self.request.user))


def scoped_depots(request):
    """Dépôts retenus pour l'état des stocks : (dépôt choisi, ensemble de dépôts).

    Paramètres : `depot` (un dépôt) ou `library` (tous les dépôts d'une librairie ; `central` pour
    l'entrepôt général). Sans paramètre, un employé voit sa librairie ; l'administrateur voit tout.
    """
    params = request.query_params
    user = request.user
    if params.get("depot"):
        depot = Depot.all_objects.filter(pk=params["depot"]).first()
        if depot is None or not can_read_depot(user, depot):
            raise PermissionDenied("Vous n'avez pas accès au stock de ce dépôt.")
        return depot.pk, None
    library = params.get("library")
    if library:
        depots = Depot.all_objects.filter(library__isnull=True) if library == "central" else \
            Depot.all_objects.filter(library_id=library)
        ids = set(depots.values_list("pk", flat=True))
        readable = readable_depot_ids(user)
        if readable is not None and not ids <= readable:
            raise PermissionDenied("Vous n'avez pas accès au stock de cette librairie.")
        return None, ids
    restricted = user.restricted_library
    if restricted is not None:
        return None, set(Depot.all_objects.filter(library=restricted).values_list("pk", flat=True))
    return None, None


def stock_state_queryset(depot_id=None, depot_ids=None):
    """Articles stockés annotés : physique, réservé, disponible, valeur (CMP) et statut OK / LOW / OUT.

    `depot_id` limite à un dépôt ; `depot_ids` (ensemble) limite à plusieurs dépôts (une librairie).
    """
    level_filter = Q(stock_levels__is_deleted=False)
    if depot_id:
        level_filter &= Q(stock_levels__depot_id=depot_id)
    elif depot_ids is not None:
        level_filter &= Q(stock_levels__depot_id__in=depot_ids)
    return (
        Article.objects.filter(is_active=True)
        .filter(Q(type=Article.Type.SIMPLE) | Q(type=Article.Type.KIT, kit__stock_mode=Kit.StockMode.ASSEMBLED))
        .annotate(
            quantity=Coalesce(Sum("stock_levels__quantity", filter=level_filter), 0),
            reserved=Coalesce(Sum("stock_levels__reserved", filter=level_filter), 0),
        )
        .annotate(available=F("quantity") - F("reserved"))
        .annotate(
            value=Case(When(quantity__gt=0, then=F("quantity") * F("avg_cost")), default=Value(0),
                       output_field=IntegerField()),
            status=Case(
                When(available__lte=0, then=Value("OUT")),
                When(available__lte=F("alert_threshold"), then=Value("LOW")),
                default=Value("OK"),
            ),
        )
    )


class StockStateView(generics.ListAPIView):
    """État des stocks : un article stocké par ligne, totaux tous dépôts ou pour un dépôt donné."""

    serializer_class = StockStateSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "stock.view"
    search_fields = ["name", "code", "barcodes__code"]
    ordering_fields = ["name", "code", "available", "value"]
    ordering = ["name"]

    @extend_schema(parameters=[
        OpenApiParameter("depot", str), OpenApiParameter("library", str), OpenApiParameter("category", str),
        OpenApiParameter("status", str, enum=["OK", "LOW", "OUT"]),
    ])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        params = self.request.query_params
        depot_id, depot_ids = scoped_depots(self.request)
        queryset = stock_state_queryset(depot_id, depot_ids).select_related("category__parent")
        if params.get("category"):
            from apps.catalog.models import Category

            category = Category.objects.filter(pk=params["category"]).first()
            queryset = queryset.filter(category_id__in=category.descendant_ids()) if category else queryset.none()
        if params.get("status") in ("OK", "LOW", "OUT"):
            queryset = queryset.filter(status=params["status"])
        return queryset.distinct()


class StockSummaryView(APIView):
    """Indicateurs : valeur du stock au CMP et nombre d'articles en stock bas / rupture."""

    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "stock.view"

    @extend_schema(responses=inline_serializer("StockSummary", {
        "valuation": serializers.IntegerField(), "low": serializers.IntegerField(), "out": serializers.IntegerField(),
    }), parameters=[OpenApiParameter("depot", str), OpenApiParameter("library", str)])
    def get(self, request):
        depot_id, depot_ids = scoped_depots(request)
        # Le statut dépend d'agrégats : on filtre (HAVING) puis on compte, plutôt qu'un GROUP BY sur le statut.
        state = stock_state_queryset(depot_id, depot_ids)
        if depot_id:
            valuation = services.depot_valuation(Depot.all_objects.get(pk=depot_id))
        elif depot_ids is not None:
            valuation = sum(services.depot_valuation(depot) for depot in Depot.all_objects.filter(pk__in=depot_ids))
        else:
            valuation = services.depot_valuation(None)
        return Response({"valuation": valuation, "low": state.filter(status="LOW").count(),
                         "out": state.filter(status="OUT").count()})


class MovementFilter(django_filters.FilterSet):
    date_from = django_filters.IsoDateTimeFilter(field_name="occurred_at", lookup_expr="gte")
    date_to = django_filters.IsoDateTimeFilter(field_name="occurred_at", lookup_expr="lte")
    kind = django_filters.MultipleChoiceFilter(choices=StockMovement.Kind.choices)

    class Meta:
        model = StockMovement
        fields = ["article", "depot", "kind", "source_type", "source_id"]


class StockMovementViewSet(viewsets.ReadOnlyModelViewSet):
    """Journal des mouvements (lecture seule : les écritures passent par les opérations métier)."""

    serializer_class = StockMovementSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "stock.view"
    filterset_class = MovementFilter
    search_fields = ["article__name", "article__code", "reference", "reason"]
    ordering_fields = ["occurred_at", "quantity"]

    def get_queryset(self):
        queryset = StockMovement.objects.select_related("article", "depot", "user")
        return filter_by_depots(queryset, readable_depot_ids(self.request.user))

    @extend_schema(parameters=[OpenApiParameter("article", str, required=True), OpenApiParameter("depot", str)],
                   responses=StockCardLineSerializer(many=True))
    @action(detail=False, methods=["get"])
    def card(self, request):
        """Fiche de stock d'un article : historique avec solde progressif."""
        article = get_object_or_404(Article, pk=request.query_params.get("article"))
        depot = Depot.objects.filter(pk=request.query_params.get("depot")).first() if request.query_params.get(
            "depot") else None
        if depot is not None and not can_read_depot(request.user, depot):
            raise PermissionDenied("Vous n'avez pas accès au stock de ce dépôt.")
        lines = services.stock_card(article, depot, depot_ids=readable_depot_ids(request.user))
        return Response([{"movement": StockMovementSerializer(line.movement).data, "balance": line.balance}
                         for line in reversed(lines)])

    @extend_schema(request=AdjustmentSerializer, responses={201: StockMovementSerializer})
    @action(detail=False, methods=["post"], url_path="adjust")
    def adjust(self, request):
        """Perte / casse, ajustement manuel ou stock initial (motif obligatoire, tracé dans l'audit)."""
        if not request.user.has_app_perm("stock.manage"):
            return Response({"detail": "Permission « Ajustements, pertes et casse » requise."}, status=403)
        data = AdjustmentSerializer(data=request.data, context={"request": request})
        data.is_valid(raise_exception=True)
        values = data.validated_data
        movement = services.adjust(values["article"], values["depot"], values["quantity"], kind=values["kind"],
                                   reason=values["reason"], user=request.user,
                                   allow_negative=values["kind"] == StockMovement.Kind.ADJUSTMENT)
        log_event(AuditLog.Action.UPDATE, request=request, entity="StockMovement", entity_id=movement.pk,
                  description=f"{movement.get_kind_display()} : {movement.quantity:+d} {values['article'].name} "
                              f"({values['depot'].code}) — {values['reason']}")
        return Response(StockMovementSerializer(movement).data, status=201)


class StockTransferViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                           mixins.UpdateModelMixin, viewsets.GenericViewSet):
    serializer_class = StockTransferSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "stock.view", "write": "stock.transfer"}
    filterset_fields = ["status", "from_depot", "to_depot"]
    search_fields = ["number", "note"]

    def get_queryset(self):
        queryset = StockTransfer.objects.select_related("from_depot", "to_depot", "created_by", "validated_by") \
            .prefetch_related("lines__article")
        readable = readable_depot_ids(self.request.user)
        if readable is None:
            return queryset
        return queryset.filter(Q(from_depot_id__in=readable) | Q(to_depot_id__in=readable))

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @extend_schema(request=None, responses=StockTransferSerializer)
    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        transfer = self.get_object()
        user = request.user
        if not (can_manage_depot(user, transfer.from_depot) or can_manage_depot(user, transfer.to_depot)):
            raise PermissionDenied("Ce transfert ne concerne pas votre librairie.")
        transfer = services.validate_transfer(transfer, user=request.user)
        log_event(AuditLog.Action.UPDATE, request=request, entity="StockTransfer", entity_id=transfer.pk,
                  description=f"Validation du transfert {transfer.number}")
        return Response(self.get_serializer(self.get_queryset().get(pk=transfer.pk)).data)

    @extend_schema(request=None, responses=StockTransferSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        transfer = self.get_object()
        if transfer.status != StockTransfer.Status.DRAFT:
            return Response({"detail": "Seul un brouillon peut être annulé."}, status=400)
        transfer.status = StockTransfer.Status.CANCELLED
        transfer.save(update_fields=["status"])
        return Response(self.get_serializer(transfer).data)


class KitAssemblyViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                         viewsets.GenericViewSet):
    queryset = KitAssembly.objects.select_related("kit__article", "depot", "user")
    serializer_class = KitAssemblySerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "stock.view", "write": "stock.kit_assembly"}
    filterset_fields = ["kit", "depot", "operation"]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        assembly = services.assemble_kits(data["kit"], data["depot"], data["quantity"], data["operation"],
                                          user=request.user, note=data.get("note", ""))
        log_event(AuditLog.Action.CREATE, request=request, entity="KitAssembly", entity_id=assembly.pk,
                  description=f"{assembly.get_operation_display()} de {assembly.quantity} × "
                              f"{assembly.kit.article.name} ({assembly.depot.code})")
        return Response(self.get_serializer(assembly).data, status=status.HTTP_201_CREATED)


class StockAlertViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StockAlertSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "stock.view"
    filterset_fields = ["kind"]

    def get_queryset(self):
        queryset = StockAlert.objects.select_related("article")
        if self.request.query_params.get("resolved") not in ("1", "true"):
            queryset = queryset.filter(resolved_at__isnull=True)
        return queryset.order_by("kind", "available")

    @extend_schema(request=None, responses=inline_serializer("AlertRefresh", {"open": serializers.IntegerField()}))
    @action(detail=False, methods=["post"])
    def refresh(self, request):
        """Recalcule immédiatement les alertes (sinon fait toutes les heures par Celery beat)."""
        return Response({"open": services.refresh_all_alerts()})
