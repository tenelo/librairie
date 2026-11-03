"""Prix par librairie : API de consultation et de modification.

- Le prix saisi par l'administrateur sur l'article (permission « Modifier les prix ») s'applique
  à toutes les librairies.
- Une librairie peut le remplacer pour ses propres ventes : il faut la permission
  « Modifier les prix de sa librairie », et l'employé ne touche qu'à sa librairie.
  L'administrateur (ou un utilisateur sans librairie ayant « Modifier les prix ») le fait pour
  n'importe quelle librairie.
- Supprimer le prix propre rétablit le prix du catalogue.
- Chaque modification est tracée dans le journal d'audit.
"""
from rest_framework import serializers, viewsets
from rest_framework.exceptions import PermissionDenied

from apps.audit.mixins import AuditedViewSetMixin
from apps.core.permissions import HasAppPermission, IsStaffMember
from apps.stock.models import Library

from .models import Article, ArticleLibraryPrice

GLOBAL_PRICES = "catalog.prices"
LIBRARY_PRICES = "catalog.library_prices"


class ArticleLibraryPriceSerializer(serializers.ModelSerializer):
    article = serializers.PrimaryKeyRelatedField(queryset=Article.objects.all())
    library = serializers.PrimaryKeyRelatedField(queryset=Library.objects.all())
    article_code = serializers.CharField(source="article.code", read_only=True)
    article_name = serializers.CharField(source="article.name", read_only=True)
    library_name = serializers.CharField(source="library.name", read_only=True)
    catalog_retail_price = serializers.IntegerField(source="article.retail_price", read_only=True)
    catalog_wholesale_price = serializers.IntegerField(source="article.wholesale_price", read_only=True,
                                                       allow_null=True)
    changed_by_name = serializers.CharField(source="changed_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = ArticleLibraryPrice
        fields = ["id", "article", "article_code", "article_name", "library", "library_name", "retail_price",
                  "wholesale_price", "catalog_retail_price", "catalog_wholesale_price", "changed_by_name",
                  "updated_at", "sync_version"]
        read_only_fields = ["changed_by_name", "updated_at", "sync_version"]
        validators = []

    def validate(self, attrs):
        article = attrs.get("article", getattr(self.instance, "article", None))
        library = attrs.get("library", getattr(self.instance, "library", None))
        if article is not None and article.type == Article.Type.KIT and article.kit.pricing_mode == "COMPUTED":
            raise serializers.ValidationError(
                {"article": "Le prix de ce kit est calculé à partir de ses composants : modifiez-les plutôt."})
        if article is not None and article.wholesale_price is None and attrs.get("wholesale_price") is not None:
            raise serializers.ValidationError(
                {"wholesale_price": "Cet article n'a pas de prix de gros dans le catalogue."})
        duplicates = ArticleLibraryPrice.objects.filter(article=article, library=library)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError({"article": "Cette librairie a déjà un prix pour cet article."})
        return attrs


class ArticleLibraryPriceViewSet(AuditedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = ArticleLibraryPriceSerializer
    permission_classes = [IsStaffMember, HasAppPermission]
    required_permissions = {"read": "catalog.view"}
    filterset_fields = ["article", "library"]
    search_fields = ["article__name", "article__code"]
    pagination_class = None
    audit_entity = "ArticleLibraryPrice"

    def get_queryset(self):
        queryset = ArticleLibraryPrice.objects.select_related("article__kit", "library", "changed_by")
        library = self.request.user.restricted_library
        if library is not None and not self.request.user.has_app_perm("stock.view_all_libraries"):
            queryset = queryset.filter(library=library)
        return queryset

    def _check_can_edit(self, library):
        user = self.request.user
        restricted = user.restricted_library
        if restricted is None:
            if user.has_app_perm(GLOBAL_PRICES) or user.has_app_perm(LIBRARY_PRICES):
                return
        elif library == restricted and user.has_app_perm(LIBRARY_PRICES):
            return
        raise PermissionDenied("Vous ne pouvez modifier que les prix de votre librairie.")

    def perform_create(self, serializer):
        self._check_can_edit(serializer.validated_data["library"])
        serializer.save(changed_by=self.request.user)

    def perform_update(self, serializer):
        old_library = serializer.instance.library
        self._check_can_edit(old_library)
        self._check_can_edit(serializer.validated_data.get("library", old_library))
        serializer.save(changed_by=self.request.user)

    def perform_destroy(self, instance):
        self._check_can_edit(instance.library)
        super().perform_destroy(instance)
