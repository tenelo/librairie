import uuid

from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractUser, UserManager
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models

from .catalog import ADMIN, CLIENT, ROLE_CHOICES

phone_validator = RegexValidator(
    r"^\+?[0-9 ]{8,20}$", "Numéro de téléphone invalide (chiffres, espaces et + uniquement)."
)
pin_validator = RegexValidator(r"^[0-9]{4,6}$", "Le code PIN doit comporter 4 à 6 chiffres.")


class Permission(models.Model):
    """Permission applicative (granularité par action), distincte des permissions Django."""

    code = models.CharField("code", max_length=64, unique=True)
    label = models.CharField("libellé", max_length=150)
    module = models.CharField("module", max_length=64)

    class Meta:
        ordering = ["module", "code"]
        verbose_name = "permission"

    def __str__(self):
        return self.code


class Role(models.Model):
    code = models.CharField("code", max_length=20, unique=True, choices=ROLE_CHOICES)
    label = models.CharField("libellé", max_length=64)
    description = models.TextField("description", blank=True)
    is_staff_role = models.BooleanField("accès au backoffice", default=True)
    max_discount_percent = models.PositiveSmallIntegerField(
        "remise maximale (%)", default=0, validators=[MaxValueValidator(100)]
    )
    permissions = models.ManyToManyField(Permission, related_name="roles", blank=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "rôle"

    def __str__(self):
        return self.label


class LibraryUserManager(UserManager):
    def get_by_identifier(self, identifier):
        """Retrouve un utilisateur par identifiant de connexion ou par téléphone."""
        identifier = (identifier or "").strip()
        user = self.filter(username__iexact=identifier).first()
        if user is None and identifier:
            user = self.filter(phone=normalize_phone(identifier)).first()
        return user


def normalize_phone(value):
    return "".join(ch for ch in (value or "") if ch.isdigit() or ch == "+") or None


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField("adresse e-mail", blank=True)
    phone = models.CharField(
        "téléphone", max_length=20, unique=True, null=True, blank=True, validators=[phone_validator]
    )
    role = models.ForeignKey(Role, verbose_name="rôle", on_delete=models.PROTECT, null=True, blank=True)
    pin_hash = models.CharField("PIN (haché)", max_length=128, blank=True)
    offline_max_hours = models.PositiveIntegerField(
        "durée hors ligne max (h)",
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(24 * 30)],
        help_text="Vide : valeur des paramètres de la librairie.",
    )
    must_change_password = models.BooleanField("doit changer son mot de passe", default=False)

    objects = LibraryUserManager()

    class Meta:
        ordering = ["last_name", "first_name", "username"]
        verbose_name = "utilisateur"

    def save(self, *args, **kwargs):
        self.phone = normalize_phone(self.phone)
        super().save(*args, **kwargs)

    @property
    def role_code(self):
        return self.role.code if self.role_id else None

    @property
    def is_admin_role(self):
        return self.is_superuser or self.role_code == ADMIN

    @property
    def is_client(self):
        return self.role_code == CLIENT

    def get_app_permissions(self):
        """Codes de permission effectifs (mis en cache sur l'instance)."""
        if not hasattr(self, "_app_perm_cache"):
            if self.is_superuser:
                self._app_perm_cache = set(Permission.objects.values_list("code", flat=True))
            elif self.role_id:
                self._app_perm_cache = set(self.role.permissions.values_list("code", flat=True))
            else:
                self._app_perm_cache = set()
        return self._app_perm_cache

    def has_app_perm(self, code):
        if not self.is_active:
            return False
        if self.is_superuser:
            return True
        return code in self.get_app_permissions()

    def set_pin(self, raw_pin):
        pin_validator(raw_pin)
        self.pin_hash = make_password(raw_pin)

    def check_pin(self, raw_pin):
        return bool(self.pin_hash) and check_password(raw_pin, self.pin_hash)

    @property
    def has_pin(self):
        return bool(self.pin_hash)

    def get_full_name(self):
        full = super().get_full_name()
        return full or self.username


class Device(models.Model):
    """Terminal enregistré (caisse, tablette, poste). Son code préfixe les numéros de reçus hors ligne."""

    KIND_CHOICES = [("CAISSE", "Caisse"), ("TABLETTE", "Tablette"), ("POSTE", "Poste de travail")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(
        "code terminal",
        max_length=10,
        unique=True,
        validators=[RegexValidator(r"^[A-Z0-9]{2,10}$", "Code de 2 à 10 caractères (A-Z, 0-9).")],
    )
    name = models.CharField("nom", max_length=100)
    kind = models.CharField("type", max_length=10, choices=KIND_CHOICES, default="CAISSE")
    is_active = models.BooleanField("actif", default=True)
    last_seen_at = models.DateTimeField("vu pour la dernière fois", null=True, blank=True)
    last_sync_at = models.DateTimeField("dernière synchronisation", null=True, blank=True)
    registered_by = models.ForeignKey(
        User, verbose_name="enregistré par", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "terminal"

    def save(self, *args, **kwargs):
        self.code = (self.code or "").strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} — {self.name}"
