import django_filters
from django.db.models import Count, Prefetch, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.mixins import AuditedViewSetMixin
from apps.audit.models import AuditLog
from apps.audit.services import log_event
from apps.core.permissions import HasAppPermission, IsStaffMember

from . import excel
from .models import (
    Article,
    ArticleImage,
    Barcode,
    Brand,
    Category,
    Kit,
    KitComponent,
    SchoolLevel,
    SchoolYear,
    Unit,
)
from .serializers import (
    ArticleImageSerializer,
    ArticleLookupSerializer,
    ArticleSerializer,
    BarcodeSerializer,
    BrandSerializer,
    CategorySerializer,
    KitCustomizeSerializer,
    KitDuplicateSerializer,
    KitSerializer,
    PriceHistorySerializer,
    SchoolLevelSerializer,
    SchoolYearSerializer,
    UnitSerializer,
)
from .services import (
    add_internal_barcode,
    customize_kit,
    duplicate_kit,
    price_snapshot,
    record_price_changes,
    refresh_kits_using,
)

CATALOG_PERMISSIONS = {"read": "catalog.view", "write": "catalog.manage"}


def xlsx_response(content: bytes, filename: str) -> HttpResponse:
    response = HttpResponse(content, content_type=excel.XLSX_CONTENT_TYPE)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


class CategoryViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = CATALOG_PERMISSIONS
    pagination_class = None
    audit_entity = "Category"

    def get_queryset(self):
        return (
            Category.objects.select_related("parent")
            .annotate(article_count=Count("articles", filter=Q(articles__is_deleted=False)))
            .order_by("sort_order", "name")
        )

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        if Category.objects.filter(parent=category).exists():
            return Response({"detail": "Supprimez ou déplacez d'abord les sous-catégories."}, status=400)
        if Article.objects.filter(category=category).exists():
            return Response({"detail": "Des articles sont rattachés à cette catégorie."}, status=400)
        self.perform_destroy(category)
        return Response(status=status.HTTP_204_NO_CONTENT)


class BrandViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = Brand.objects.all()
    serializer_class = BrandSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = CATALOG_PERMISSIONS
    pagination_class = None
    search_fields = ["name"]
    audit_entity = "Brand"


class UnitViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = Unit.objects.all()
    serializer_class = UnitSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = CATALOG_PERMISSIONS
    pagination_class = None
    audit_entity = "Unit"


class ArticleFilter(django_filters.FilterSet):
    type = django_filters.MultipleChoiceFilter(choices=Article.Type.choices)
    category = django_filters.UUIDFilter(method="filter_category")
    barcode = django_filters.CharFilter(field_name="barcodes__code")

    class Meta:
        model = Article
        fields = ["type", "brand", "is_active", "is_online", "category", "barcode"]

    def filter_category(self, queryset, name, value):
        category = Category.objects.filter(pk=value).first()
        if category is None:
            return queryset.none()
        return queryset.filter(category_id__in=category.descendant_ids())


class ArticleViewSet(viewsets.ModelViewSet):
    """Articles du catalogue. La suppression est logique et refusée si l'article compose un kit."""

    serializer_class = ArticleSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {
        **CATALOG_PERMISSIONS,
        "lookup": "catalog.view",
        "by_barcode": "catalog.view",
        "price_history": "catalog.view",
        "export": "catalog.import",
    }
    filterset_class = ArticleFilter
    search_fields = ["name", "code", "barcodes__code", "brand__name"]
    ordering_fields = ["name", "code", "retail_price", "updated_at", "created_at"]
    ordering = ["name"]

    def get_queryset(self):
        return (
            Article.objects.select_related("category__parent", "brand", "unit", "lot_base_article", "kit")
            .prefetch_related("barcodes", "images")
            .distinct()
        )

    def perform_create(self, serializer):
        article = serializer.save()
        log_event(AuditLog.Action.CREATE, request=self.request, entity="Article", entity_id=article.pk,
                  description=f"Création de l'article {article.code} — {article.name}",
                  new_values={"code": article.code, "name": article.name, "type": article.type,
                              "retail_price": article.retail_price})

    def perform_update(self, serializer):
        article = serializer.instance
        before_prices = price_snapshot(article)
        before = {"name": article.name, "is_active": article.is_active, "is_online": article.is_online,
                  "category": str(article.category_id or "")}
        article = serializer.save()
        changes = record_price_changes(article, before_prices, user=self.request.user, reason="Fiche article")
        if changes:
            log_event(AuditLog.Action.PRICE_CHANGE, request=self.request, entity="Article", entity_id=article.pk,
                      description=f"Modification de prix : {article.code} — {article.name}",
                      old_values={c.field: c.old_value for c in changes},
                      new_values={c.field: c.new_value for c in changes})
            if any(c.field == "retail_price" for c in changes):
                refresh_kits_using(article, user=self.request.user)
        after = {"name": article.name, "is_active": article.is_active, "is_online": article.is_online,
                 "category": str(article.category_id or "")}
        if before != after:
            log_event(AuditLog.Action.UPDATE, request=self.request, entity="Article", entity_id=article.pk,
                      description=f"Modification de l'article {article.code}", old_values=before, new_values=after)

    def destroy(self, request, *args, **kwargs):
        article = self.get_object()
        if article.type == Article.Type.KIT:
            return Response({"detail": "Supprimez ce kit depuis l'écran « Kits scolaires »."}, status=400)
        kits = Kit.objects.filter(components__article=article, components__is_deleted=False).distinct()
        if kits.exists():
            names = ", ".join(k.article.name for k in kits.select_related("article")[:5])
            return Response({"detail": f"Cet article compose des kits ({names}) : retirez-le d'abord."}, status=400)
        article.soft_delete()
        for barcode in article.barcodes.all():
            barcode.soft_delete()
        log_event(AuditLog.Action.DELETE, request=request, entity="Article", entity_id=article.pk,
                  description=f"Suppression de l'article {article.code} — {article.name}")
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses=ArticleLookupSerializer(many=True),
                   parameters=[OpenApiParameter("search", str), OpenApiParameter("exclude_kits", bool)])
    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Recherche rapide (code, nom, code-barres) pour les listes de choix ; 20 résultats maximum."""
        queryset = self.filter_queryset(self.get_queryset())
        if request.query_params.get("exclude_kits") in ("1", "true"):
            queryset = queryset.exclude(type=Article.Type.KIT)
        return Response(ArticleLookupSerializer(queryset[:20], many=True).data)

    @extend_schema(parameters=[OpenApiParameter("code", str, required=True)], responses={200: ArticleSerializer})
    @action(detail=False, methods=["get"], url_path="by-barcode")
    def by_barcode(self, request):
        """Article correspondant exactement à un code-barres (douchette, caméra) ou à un code interne."""
        code = (request.query_params.get("code") or "").strip()
        barcode = Barcode.objects.filter(code=code, article__is_deleted=False).select_related("article").first()
        article = barcode.article if barcode else Article.objects.filter(code__iexact=code).first()
        if article is None:
            return Response({"detail": f"Aucun article pour le code {code}."}, status=404)
        return Response(ArticleSerializer(article, context=self.get_serializer_context()).data)

    @extend_schema(request=None, responses=BarcodeSerializer)
    @action(detail=True, methods=["post"], url_path="generate-barcode")
    def generate_barcode(self, request, pk=None):
        barcode = add_internal_barcode(self.get_object())
        return Response(BarcodeSerializer(barcode).data, status=201)

    @extend_schema(responses=PriceHistorySerializer(many=True))
    @action(detail=True, methods=["get"], url_path="price-history")
    def price_history(self, request, pk=None):
        return Response(PriceHistorySerializer(self.get_object().price_history.all()[:100], many=True).data)

    @extend_schema(
        request={"multipart/form-data": inline_serializer("ImageUpload", {"image": serializers.ImageField()})},
        responses=ArticleImageSerializer,
    )
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def images(self, request, pk=None):
        article = self.get_object()
        upload = request.FILES.get("image")
        if upload is None:
            return Response({"image": ["Aucun fichier reçu."]}, status=400)
        if upload.size > 5 * 1024 * 1024:
            return Response({"image": ["Image trop lourde (5 Mo maximum)."]}, status=400)
        serializer = ArticleImageSerializer(data={"image": upload, "sort_order": article.images.count()},
                                            context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        serializer.save(article=article)
        return Response(serializer.data, status=201)

    @extend_schema(request=None, responses={204: None},
                   parameters=[OpenApiParameter("image_id", OpenApiTypes.UUID, OpenApiParameter.PATH)])
    @action(detail=True, methods=["delete"], url_path=r"images/(?P<image_id>[^/.]+)")
    def delete_image(self, request, pk=None, image_id=None):
        image = get_object_or_404(ArticleImage, pk=image_id, article=self.get_object())
        image.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={(200, excel.XLSX_CONTENT_TYPE): bytes})
    @action(detail=False, methods=["get"])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).exclude(type=Article.Type.KIT)
        stamp = timezone.localdate().strftime("%Y%m%d")
        return xlsx_response(excel.export_articles(queryset), f"articles-{stamp}.xlsx")


class SchoolLevelViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = SchoolLevel.objects.all()
    serializer_class = SchoolLevelSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "catalog.manage"}
    pagination_class = None
    filterset_fields = ["cycle", "is_active"]
    audit_entity = "SchoolLevel"

    def destroy(self, request, *args, **kwargs):
        level = self.get_object()
        if Kit.objects.filter(level=level).exists():
            return Response({"detail": "Des kits utilisent ce niveau : désactivez-le plutôt."}, status=400)
        return super().destroy(request, *args, **kwargs)


class SchoolYearViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    queryset = SchoolYear.objects.all()
    serializer_class = SchoolYearSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": None, "write": "catalog.manage"}
    pagination_class = None
    audit_entity = "SchoolYear"

    def destroy(self, request, *args, **kwargs):
        if Kit.objects.filter(school_year=self.get_object()).exists():
            return Response({"detail": "Des kits sont rattachés à cette année scolaire."}, status=400)
        return super().destroy(request, *args, **kwargs)


class KitFilter(django_filters.FilterSet):
    is_active = django_filters.BooleanFilter(field_name="article__is_active")
    no_school = django_filters.BooleanFilter(field_name="school", lookup_expr="isnull")
    ids = django_filters.BaseInFilter(field_name="id")

    class Meta:
        model = Kit
        fields = ["level", "school", "school_year", "stock_mode", "pricing_mode", "is_active", "no_school", "ids"]


class KitViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                 mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = KitSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {
        **CATALOG_PERMISSIONS,
        "customize": "catalog.view",
        "export": "catalog.view",
        "duplicate": "catalog.manage",
    }
    filterset_class = KitFilter
    search_fields = ["article__name", "article__code", "school__name", "level__label"]
    ordering_fields = ["article__name", "level__sort_order", "updated_at"]
    ordering = ["level__sort_order", "article__name"]

    def get_queryset(self):
        live_components = KitComponent.objects.filter(is_deleted=False).select_related("article").prefetch_related(
            "substitutes__barcodes")
        return (
            Kit.objects.select_related("article", "article__category", "level", "school", "school_year")
            .prefetch_related(Prefetch("components", queryset=live_components), "article__barcodes")
        )

    def perform_create(self, serializer):
        kit = serializer.save()
        log_event(AuditLog.Action.CREATE, request=self.request, entity="Kit", entity_id=kit.pk,
                  description=f"Création du kit {kit.article.code} — {kit.article.name}",
                  new_values={"level": kit.level.code, "components": kit.components.count(),
                              "price": kit.article.retail_price})

    def perform_update(self, serializer):
        before = {"price": serializer.instance.article.retail_price,
                  "pricing_mode": serializer.instance.pricing_mode,
                  "discount_percent": str(serializer.instance.discount_percent),
                  "components": sorted(f"{c.article.code}×{c.quantity}" for c in serializer.instance.components.all())}
        kit = serializer.save()
        kit = self.get_queryset().get(pk=kit.pk)
        after = {"price": kit.article.retail_price, "pricing_mode": kit.pricing_mode,
                 "discount_percent": str(kit.discount_percent),
                 "components": sorted(f"{c.article.code}×{c.quantity}" for c in kit.components.all())}
        action_name = AuditLog.Action.PRICE_CHANGE if before["price"] != after["price"] else AuditLog.Action.UPDATE
        log_event(action_name, request=self.request, entity="Kit", entity_id=kit.pk,
                  description=f"Modification du kit {kit.article.code}", old_values=before, new_values=after)

    def perform_destroy(self, kit):
        kit.soft_delete()
        kit.article.soft_delete()
        log_event(AuditLog.Action.DELETE, request=self.request, entity="Kit", entity_id=kit.pk,
                  description=f"Suppression du kit {kit.article.code} — {kit.article.name}")

    @extend_schema(request=KitDuplicateSerializer, responses={201: KitSerializer})
    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        kit = self.get_object()
        params = KitDuplicateSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        data = params.validated_data
        copy = duplicate_kit(
            kit, name=data.get("name") or None, level=data.get("level"), school_year=data.get("school_year"),
            school=data.get("school"), keep_school="school" not in data, user=request.user,
        )
        log_event(AuditLog.Action.CREATE, request=request, entity="Kit", entity_id=copy.pk,
                  description=f"Duplication du kit {kit.article.code} vers {copy.article.code}")
        copy = self.get_queryset().get(pk=copy.pk)
        return Response(KitSerializer(copy, context=self.get_serializer_context()).data, status=201)

    @extend_schema(
        request=KitCustomizeSerializer,
        responses=inline_serializer("KitCustomization", {
            "base_price": serializers.IntegerField(), "price": serializers.IntegerField(),
            "lines": serializers.ListField(child=serializers.DictField()),
            "adjustments": serializers.ListField(child=serializers.DictField()),
        }),
    )
    @action(detail=True, methods=["post"])
    def customize(self, request, pk=None):
        """Aperçu du prix d'un kit dont le client retire ou remplace des composants."""
        params = KitCustomizeSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        result = customize_kit(self.get_object(), params.validated_data["removed"],
                               params.validated_data["substitutions"])
        return Response(result.as_dict())

    @extend_schema(responses={(200, excel.XLSX_CONTENT_TYPE): bytes})
    @action(detail=False, methods=["get"])
    def export(self, request):
        kits = list(self.filter_queryset(self.get_queryset()))
        stamp = timezone.localdate().strftime("%Y%m%d")
        return xlsx_response(excel.export_kits(kits), f"listes-fournitures-{stamp}.xlsx")


class ImportSerializer(serializers.Serializer):
    file = serializers.FileField()
    dry_run = serializers.BooleanField(default=False)


IMPORT_RESULT = inline_serializer("ImportResult", {
    "created": serializers.IntegerField(), "updated": serializers.IntegerField(),
    "errors": serializers.ListField(child=serializers.DictField()), "dry_run": serializers.BooleanField(),
    "applied": serializers.BooleanField(),
})


class BaseImportView(APIView):
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "catalog.import"
    parser_classes = [MultiPartParser, FormParser]
    importer = None
    entity = ""

    @extend_schema(request={"multipart/form-data": ImportSerializer}, responses=IMPORT_RESULT)
    def post(self, request):
        params = ImportSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        upload = params.validated_data["file"]
        if not upload.name.lower().endswith(".xlsx"):
            return Response({"file": ["Fichier Excel .xlsx attendu."]}, status=400)
        result = type(self).importer(upload, request.user, dry_run=params.validated_data["dry_run"])
        if result["applied"]:
            log_event(AuditLog.Action.UPDATE, request=request, entity=self.entity,
                      description=f"Import Excel {upload.name} : {result['created']} créé(s), "
                                  f"{result['updated']} mis à jour")
        return Response(result)


class ArticleImportView(BaseImportView):
    importer = staticmethod(excel.import_articles)
    entity = "Article"


class KitImportView(BaseImportView):
    importer = staticmethod(excel.import_kits)
    entity = "Kit"


class TemplateView(APIView):
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = "catalog.import"

    @extend_schema(responses={(200, excel.XLSX_CONTENT_TYPE): bytes})
    def get(self, request, kind):
        if kind == "articles":
            return xlsx_response(excel.articles_template(), "modele-articles.xlsx")
        if kind == "kits":
            return xlsx_response(excel.kits_template(), "modele-listes-fournitures.xlsx")
        return Response({"detail": "Modèle inconnu."}, status=404)
