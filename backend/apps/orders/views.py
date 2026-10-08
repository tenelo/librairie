from django.conf import settings
from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.catalog.models import Article, Category, Kit, SchoolLevel
from apps.catalog.serializers import CategorySerializer, SchoolLevelSerializer
from apps.catalog.services import article_availability
from apps.core.permissions import HasAppPermission, IsStaffMember
from apps.customers.models import School
from apps.customers.serializers import SchoolSerializer
from apps.stock.services import stock_lookup

from . import services
from .models import OnlineOrder, PaymentTransaction
from .payments import OPERATORS, get_provider
from .serializers import (
    CancelSerializer,
    DepositSerializer,
    OnlineOrderSerializer,
    PickupPointSerializer,
    PlaceOrderSerializer,
    PrepareSerializer,
    ShopArticleSerializer,
    ShopKitSerializer,
    ShopOrderSerializer,
)

# --- Personnel ---------------------------------------------------------------------------------


class OnlineOrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Commandes en ligne côté librairie : confirmation, préparation, annulation, retrait."""

    serializer_class = OnlineOrderSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {
        "list": "orders.view", "retrieve": "orders.view", "picking": "orders.view", "lookup": "orders.pickup",
        "confirm": "orders.confirm", "cancel": "orders.confirm", "start": "orders.prepare",
        "prepare": "orders.prepare", "*": "orders.view",
    }
    filterset_fields = ["status", "pickup_depot", "awaiting_customer"]
    search_fields = ["number", "customer__name", "customer__phone"]

    def get_queryset(self):
        queryset = OnlineOrder.objects.select_related("customer", "pickup_depot", "preparer", "sale").prefetch_related(
            "lines__article", "history__user", "payments")
        group = self.request.query_params.get("group")
        groups = {
            "to_confirm": Q(status=OnlineOrder.Status.RECEIVED),
            "to_prepare": Q(status__in=[OnlineOrder.Status.CONFIRMED, OnlineOrder.Status.PREPARING]),
            "ready": Q(status=OnlineOrder.Status.READY),
            "picked_up": Q(status=OnlineOrder.Status.PICKED_UP),
            "closed": Q(status__in=[OnlineOrder.Status.CANCELLED, OnlineOrder.Status.EXPIRED]),
        }
        if group in groups:
            queryset = queryset.filter(groups[group])
            if group in ("to_confirm", "to_prepare", "ready"):
                queryset = queryset.order_by("created_at")
        return queryset

    def _reply(self, order):
        return Response(self.get_serializer(self.get_queryset().get(pk=order.pk)).data)

    @extend_schema(request=None, responses=OnlineOrderSerializer)
    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        return self._reply(services.confirm(self.get_object(), request.user))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OnlineOrderSerializer)
    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """Prise en charge par un préparateur (soi-même par défaut, ou `preparer` = identifiant)."""
        preparer = None
        if request.data.get("preparer"):
            preparer = User.objects.filter(username=request.data["preparer"], is_active=True).first()
            if preparer is None or not preparer.has_app_perm("orders.prepare"):
                return Response({"preparer": "Préparateur inconnu ou non habilité."}, status=400)
        return self._reply(services.start_preparation(self.get_object(), request.user, preparer))

    @extend_schema(request=PrepareSerializer, responses=OnlineOrderSerializer)
    @action(detail=True, methods=["post"])
    def prepare(self, request, pk=None):
        params = PrepareSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        order = services.prepare(self.get_object(), request.user, lines=data.get("lines", []),
                                 shortages=data.get("shortages", []), ready=data["ready"],
                                 parcels=data.get("parcels"))
        return self._reply(order)

    @extend_schema(request=CancelSerializer, responses=OnlineOrderSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        params = CancelSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        return self._reply(services.cancel(self.get_object(), request.user, params.validated_data.get("reason", "")))

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def picking(self, request, pk=None):
        """Liste de préparation triée par emplacement."""
        order = self.get_object()
        return Response({"order": self.get_serializer(order).data, "lines": services.picking_list(order)})

    @extend_schema(parameters=[OpenApiParameter("code", str)], responses=OnlineOrderSerializer)
    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Commande à retirer : QR code, code à 6 chiffres ou numéro."""
        order = services.lookup(request.query_params.get("code", ""))
        if order is None:
            raise NotFound("Aucune commande ne correspond à ce code.")
        return self._reply(order)


# --- Catalogue public de la boutique -----------------------------------------------------------


class ShopCatalogMixin:
    permission_classes = [AllowAny]
    authentication_classes = []

    def availability_context(self, depot_id=None):
        depots = services.pickup_points()
        depot = depots.filter(pk=depot_id).first() if depot_id else None
        lookups = [stock_lookup(depot)] if depot else [stock_lookup(d) for d in depots]
        cache = {}

        def availability(article):
            if article.pk not in cache:
                values = [article_availability(article, lookup) for lookup in lookups]
                best = None if any(v is None for v in values) else max(values, default=0)
                cache[article.pk] = (services.availability_status(article, best), best)
            return cache[article.pk]

        return availability


def online_articles():
    return (Article.objects.filter(is_active=True, is_online=True)
            .select_related("category", "brand", "kit", "lot_base_article")
            .prefetch_related("images", "kit__components__article"))


class ShopArticleViewSet(ShopCatalogMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ShopArticleSerializer
    search_fields = ["name", "code", "barcodes__code", "description"]
    filterset_fields = ["type"]

    def get_queryset(self):
        queryset = online_articles().exclude(type=Article.Type.SERVICE)
        category = self.request.query_params.get("category")
        if category:
            node = Category.objects.filter(pk=category).first()
            queryset = queryset.filter(category_id__in=node.descendant_ids() if node else [])
        return queryset.distinct().order_by("name")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["availability"] = self.availability_context(self.request.query_params.get("depot"))
        return context


class ShopKitViewSet(ShopCatalogMixin, viewsets.ReadOnlyModelViewSet):
    """Kits scolaires en ligne, filtrables par établissement (`school`) et niveau (`level`)."""

    serializer_class = ShopKitSerializer
    filterset_fields = ["school", "level"]

    def get_queryset(self):
        queryset = (Kit.objects.filter(article__is_active=True, article__is_online=True)
                    .select_related("article", "article__category", "level", "school", "school_year")
                    .prefetch_related("components__article", "article__images"))
        current = self.request.query_params.get("current_year", "1")
        if current == "1":
            queryset = queryset.filter(Q(school_year__isnull=True) | Q(school_year__is_current=True))
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["availability"] = self.availability_context(self.request.query_params.get("depot"))
        return context


class ShopReferenceView(ShopCatalogMixin, APIView):
    """Données de référence de la boutique : catégories, établissements, niveaux, points de retrait."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        online = Article.objects.filter(is_active=True, is_online=True)
        category_ids = set(online.values_list("category_id", flat=True))
        categories = [c for c in Category.objects.filter(is_active=True) if c.pk in category_ids
                      or any(d in category_ids for d in c.descendant_ids())]
        kits = Kit.objects.filter(article__is_active=True, article__is_online=True)
        return Response({
            "categories": CategorySerializer(categories, many=True).data,
            "schools": SchoolSerializer(School.objects.filter(pk__in=kits.values("school")), many=True).data,
            "levels": SchoolLevelSerializer(SchoolLevel.objects.filter(pk__in=kits.values("level")), many=True).data,
            "pickup_points": PickupPointSerializer(services.pickup_points(), many=True).data,
            "operators": [{"code": code, "label": label} for code, label in OPERATORS.items()],
            "sandbox_payments": get_provider().is_sandbox,
        })


# --- Commandes du client -----------------------------------------------------------------------


class ShopOrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ShopOrderSerializer
    permission_classes = [IsAuthenticated, HasAppPermission]
    required_permissions = "shop.order"

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return OnlineOrder.objects.none()
        return (OnlineOrder.objects.filter(customer__user=self.request.user)
                .select_related("pickup_depot", "sale").prefetch_related("lines__article", "history", "payments"))

    def _reply(self, order, code=200):
        return Response(self.get_serializer(self.get_queryset().get(pk=order.pk)).data, status=code)

    @extend_schema(request=PlaceOrderSerializer, responses={201: ShopOrderSerializer})
    def create(self, request):
        params = PlaceOrderSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        order = services.place_order(request.user, params.validated_data)
        return self._reply(order, status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=ShopOrderSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._reply(services.cancel(self.get_object(), request.user, by_customer=True))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=ShopOrderSerializer)
    @action(detail=True, methods=["post"])
    def answer(self, request, pk=None):
        """Réponse à une modification proposée : `{"accept": true|false}`."""
        return self._reply(services.answer_proposal(self.get_object(), request.user,
                                                    bool(request.data.get("accept"))))

    @extend_schema(request=DepositSerializer, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"])
    def deposit(self, request, pk=None):
        params = DepositSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        payment, result = services.initiate_deposit(self.get_object(), request.user, **params.validated_data)
        return Response({"reference": payment.external_ref, "amount": payment.amount, "status": payment.status,
                         "instructions": result.instructions, "redirect_url": result.redirect_url,
                         "sandbox": get_provider().is_sandbox}, status=status.HTTP_201_CREATED)


class SandboxPaymentView(APIView):
    """Simulation du résultat d'un paiement (prestataire « sandbox » uniquement)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, reference):
        if not get_provider().is_sandbox:
            raise PermissionDenied("Simulation indisponible avec un prestataire réel.")
        payment = PaymentTransaction.objects.filter(external_ref=reference, order__customer__user=request.user).first()
        if payment is None:
            raise NotFound("Transaction inconnue.")
        payment = services.settle_payment(reference, bool(request.data.get("success", True)),
                                          raw={"sandbox": True, "simulated_by": request.user.username})
        return Response({"reference": payment.external_ref, "status": payment.status, "message": payment.message})


class PaymentWebhookView(APIView):
    """Notification de résultat envoyée par le prestataire de paiement."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "webhook"

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, provider):
        handler = get_provider()
        if handler.code != provider or (handler.is_sandbox and not settings.DEBUG):
            raise NotFound()
        result = handler.parse_webhook(request.data, dict(request.headers))
        payment = services.settle_payment(result.external_ref, result.succeeded, result.message, result.raw)
        return Response({"status": payment.status})
