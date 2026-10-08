# Librairie — Arborescence et modèle de données

Ce document répond à la consigne de la phase 1 : présenter, avant le code, l'arborescence complète du dépôt et le schéma des modèles de données. Les modèles marqués **(phase 1)** sont implémentés dès le socle ; les autres sont planifiés pour la phase indiquée.

## 1. Arborescence complète

```
librairie/
├── README.md
├── docker-compose.yml
├── .gitignore
├── docs/
│   └── ARCHITECTURE.md                 # ce document
├── .env.example                        # variables de docker compose
├── nginx/
│   ├── conf.d/librairie.conf           # reverse proxy HTTP : :80 backoffice, :8081 boutique
│   ├── snippets/librairie-backend.conf # /api, /ws, /admin, /static, /uploads vers Django
│   └── https.conf.example              # configuration HTTPS de production (Certbot, voir README)
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh                   # migrations + collectstatic puis lancement
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── .env.example
│   ├── manage.py
│   ├── pytest.ini
│   ├── conftest.py
│   ├── config/
│   │   ├── __init__.py                 # charge l'app Celery
│   │   ├── settings/
│   │   │   ├── __init__.py
│   │   │   ├── base.py
│   │   │   ├── dev.py
│   │   │   ├── prod.py
│   │   │   └── test.py
│   │   ├── urls.py
│   │   ├── asgi.py                     # HTTP + WebSocket (Channels)
│   │   ├── wsgi.py
│   │   └── celery.py
│   ├── apps/
│   │   ├── core/                       # SyncModel, pagination, permissions génériques, utilitaires
│   │   ├── accounts/                   # User, Role, Permission, Device, JWT, PIN
│   │   ├── settings_app/               # LibrarySettings (singleton)
│   │   ├── catalog/                    # phase 2
│   │   ├── stock/                      # phase 3
│   │   ├── purchasing/                 # phase 3
│   │   ├── sync/                       # phase 4
│   │   ├── sales/                      # phase 5
│   │   ├── inventory/                  # phase 6
│   │   ├── customers/                  # phases 5 et 7
│   │   ├── orders/                     # phase 7
│   │   ├── notifications/              # phase 8
│   │   ├── reports/                    # phase 9
│   │   └── audit/                      # socle en phase 1 (journal des connexions), complet en phase 10
│   │       (chaque app : models.py, serializers.py, views.py, urls.py, admin.py,
│   │        permissions.py, services.py, migrations/, tests/)
│   ├── fixtures/
│   └── tests/                          # tests transverses (scénarios multi-apps)
└── frontend/
    ├── Dockerfile                      # build Angular puis nginx
    ├── nginx.conf                      # sert les deux PWA (fallback index.html)
    ├── proxy.conf.mjs                  # proxy du serveur de développement vers Django
    ├── .env.example
    ├── angular.json
    ├── package.json
    ├── tsconfig.json
    └── projects/
        ├── shared/                     # bibliothèque @librairie/shared
        │   └── src/
        │       ├── public-api.ts
        │       └── lib/
        │           ├── config/         # jeton API_BASE_URL
        │           ├── models/         # interfaces TypeScript (User, Role, Device…)
        │           ├── auth/           # AuthService, intercepteur JWT, gardes, stockage jetons
        │           ├── network/        # NetworkStatusService (en ligne / hors ligne)
        │           ├── pwa/            # UpdateService (SwUpdate + bannière)
        │           ├── format/         # pipe FCFA (fr-CI, XOF sans décimales), dates Africa/Abidjan
        │           └── ui/             # composants communs (bannière mise à jour, indicateur réseau)
        ├── backoffice/                 # PWA du personnel
        │   ├── ngsw-config.json
        │   ├── public/manifest.webmanifest + icônes
        │   └── src/app/
        │       ├── app.config.ts / app.routes.ts
        │       ├── layout/             # shell : barre d'outils, menu latéral, indicateurs
        │       ├── navigation/         # définition des 12 menus + permissions requises
        │       ├── auth/               # écran de connexion
        │       ├── pages/              # tableau de bord + pages par module (phases suivantes)
        │       └── offline/            # Dexie, outbox, sync (phase 4)
        └── boutique/                   # PWA client
            ├── ngsw-config.json
            └── src/app/                # layout client, catalogue, panier, compte (phase 7)
```

## 2. Conventions communes

- **`SyncModel`** (abstrait, app `core`) — hérité par tous les modèles synchronisables :
  `id` UUID v4 (clé primaire, peut être fourni par le client), `created_at`, `updated_at`,
  `sync_version` (entier incrémenté à chaque écriture, sert aussi de curseur de `sync/pull`),
  `is_deleted` (suppression logique), `device` (FK `Device`, terminal d'origine, nullable),
  `client_timestamp` (date de l'opération sur le terminal, nullable).
- Montants en **FCFA entiers** (`PositiveBigIntegerField` / `BigIntegerField`), quantités en `Decimal(12,3)` pour les articles vendus au poids/mètre, sinon entières.
- Aucune suppression physique des données métiers ; le manager par défaut exclut `is_deleted=True`.

## 3. Modèles par application

### core
| Modèle | Champs principaux | Relations |
|---|---|---|
| `SyncModel` (abstrait) **(phase 1)** | voir ci-dessus | `device` → Device |
| `SyncCounter` **(phase 1)** | `name`, `value` | compteur global atomique de `sync_version` |

### accounts **(phase 1)**
| Modèle | Champs principaux | Relations |
|---|---|---|
| `Permission` | `code` (ex. `sales.create`), `label`, `module` | — |
| `Role` | `code` (ADMIN, GERANT, CAISSIER, MAGASINIER, PREPARATEUR, INVENTORISTE, CLIENT), `label`, `is_staff_role`, `max_discount_percent` | M2M `permissions` → Permission |
| `User` (AbstractUser, PK UUID) | `phone` (unique, identifiant boutique), `email`, `first_name`, `last_name`, `pin_hash`, `offline_max_hours`, `is_active` | FK `role` → Role ; FK `default_depot` → Depot (phase 3) |
| `Device` | `code` (unique, ex. C02), `name`, `kind` (CAISSE, TABLETTE, POSTE), `is_active`, `last_seen_at`, `last_sync_at`, `registered_by` | FK `depot` → Depot (phase 3) |

### settings_app **(phase 1)**
| Modèle | Champs principaux |
|---|---|
| `LibrarySettings` (singleton) | `name`, `logo`, `address`, `phone`, `email`, `taxpayer_number` (NCC), `receipt_header`, `receipt_footer`, `vat_enabled`, `default_vat_rate`, `offline_max_hours` (défaut 72), `order_expiry_hours` (défaut 72), `sync_interval_minutes`, `loyalty_points_per_1000` |

### audit (socle phase 1, complet phase 10)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `AuditLog` | `action` (CREATE, UPDATE, DELETE, LOGIN, LOGIN_FAILED, LOGOUT, PIN_UNLOCK, DISCOUNT_OVERRIDE, REFUND, REPRINT, DRAWER_OPEN, PRICE_CHANGE, INVENTORY_VALIDATE, SYNC_CONFLICT…), `entity`, `entity_id`, `old_values` (JSON), `new_values` (JSON), `ip_address`, `server_timestamp`, `client_timestamp`, `origin` (ONLINE, SYNC) | FK `user`, `device` ; `role_code` copié |

### catalog (phase 2, livrée)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `Category` | `name`, `sort_order`, `is_active` | FK `parent` → Category (arborescence) |
| `Brand` | `name` | — |
| `Unit` | `code`, `label` | — |
| `Article` | `code` (auto `ART-00001`, `KIT-…`, `LOT-…`, `SRV-…`), `name`, `description`, `type` (SIMPLE, KIT, LOT, SERVICE), `avg_cost` (CMP), `retail_price`, `wholesale_price`, `wholesale_min_qty`, `vat_rate`, `vat_exempt`, `alert_threshold`, `max_stock`, `is_active`, `is_online`, `lot_units` | FK `category`, `brand`, `unit` ; FK `lot_base_article` → Article (type LOT) |
| `ArticleImage` | `image`, `sort_order` | FK `article` |
| `Barcode` | `code` (unique parmi les codes actifs), `kind` (EAN13, INTERNAL = EAN-13 préfixe 20, OTHER) | FK `article` |
| `SchoolLevel` | `code` (CP1…TLE-D), `label`, `cycle`, `series`, `sort_order`, `is_active` | — |
| `SchoolYear` | `label` (2026-2027), `starts_on`, `ends_on`, `is_current` (une seule) | — |
| `Kit` | `pricing_mode` (FIXED, COMPUTED), `discount_percent`, `stock_mode` (VIRTUAL, ASSEMBLED), `notes` | O2O `article` (type KIT, porte code, nom et prix), FK `level`, `school` (nullable), `school_year` |
| `KitComponent` | `quantity`, `is_optional`, `sort_order` | FK `kit`, `article` ; M2M `substitutes` → Article |
| `PriceHistory` | `field`, `old_value`, `new_value`, `reason` | FK `article`, `changed_by` |

Écarts avec le schéma initial : le conditionnement d'un lot est porté directement par `Article`
(`lot_base_article`, `lot_units`) au lieu d'un modèle `LotDefinition`, et `KitDefinition` s'appelle `Kit`.
Les prix calculés sont arrondis selon `LibrarySettings.price_rounding` (5 FCFA par défaut).

### stock (phase 3)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `Depot` | `code`, `name`, `kind` (BOUTIQUE, RESERVE), `is_pickup_point`, `address` | — |
| `Location` | `code` (rayon/emplacement) | FK `depot` |
| `StockMovement` (ajout seul) | `kind` (PURCHASE, SALE, CUSTOMER_RETURN, SUPPLIER_RETURN, ADJUSTMENT, LOSS, TRANSFER_IN, TRANSFER_OUT, KIT_ASSEMBLY_IN/OUT, KIT_DISASSEMBLY_IN/OUT, RESERVATION, RESERVATION_RELEASE), `quantity` (signée), `unit_cost`, `source_type`, `source_id`, `occurred_at` | FK `article`, `depot`, `user` |
| `StockLevel` (projection) | `quantity`, `reserved`, `value` | FK `article`, `depot` — recalculée depuis les mouvements |
| `StockTransfer` + `StockTransferLine` | `number`, `status`, `quantity` | FK `from_depot`, `to_depot`, `article` |
| `KitAssembly` | `operation` (ASSEMBLE, DISASSEMBLE), `quantity` | FK `kit`, `depot` |
| `StockAlert` | `kind` (LOW, OUT), `resolved_at` | FK `article`, `depot` |

### purchasing (phase 3)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `Supplier` | `name`, `contact`, `phone`, `email`, `address`, `payment_terms` | — |
| `PurchaseOrder` | `number`, `status` (DRAFT, SENT, PARTIAL, RECEIVED, CANCELLED), `expected_at`, `total` | FK `supplier`, `depot` |
| `PurchaseOrderLine` | `quantity`, `unit_cost`, `received_qty` | FK `order`, `article` |
| `GoodsReceipt` + `GoodsReceiptLine` | `number`, `received_at`, `quantity`, `unit_cost` | FK `purchase_order` (nullable), `depot`, `article` |

### inventory (phase 6)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `InventorySession` | `number`, `kind` (FULL, PARTIAL, CYCLE), `status` (DRAFT, COUNTING, REVIEW, VALIDATED, CLOSED), `frozen_at`, `double_count_threshold` | FK `depot` ; M2M `categories`, `articles`, `locations` |
| `InventoryAssignment` | zones/catégories attribuées | FK `session`, `user` |
| `InventorySnapshot` | `theoretical_qty`, `unit_cost` | FK `session`, `article` (stock gelé) |
| `InventoryCount` | `quantity`, `count_round` (1 ou 2), `counted_at` | FK `session`, `article`, `location`, `user`, `device` |
| `InventoryVariance` | `theoretical`, `sales_during`, `counted`, `variance`, `value` | FK `session`, `article` |

### customers (`School` livré en phase 2, le reste en phases 5 et 7)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `School` | `name`, `city`, `phone` | — |
| `Customer` | `name`, `phone`, `email`, `credit_limit`, `credit_balance`, `loyalty_points` | O2O `user` (nullable, compte boutique) ; FK `school` |
| `CreditNote` (avoir) | `number`, `amount`, `remaining` | FK `customer`, `source_return` |
| `Voucher` (bon d'achat) | `code`, `amount`, `expires_at` | FK `customer` (nullable) |
| `LoyaltyTransaction` | `points`, `reason` | FK `customer`, `sale` |

### sales (phase 5)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `PaymentMethod` | `code` (CASH, ORANGE_MONEY, MTN_MOMO, MOOV_MONEY, WAVE, CARD, CREDIT, VOUCHER), `label`, `requires_reference`, `is_active` | — |
| `CashRegisterSession` | `opened_at`, `opening_float`, `closed_at`, `counted_cash`, `expected_cash`, `variance`, `denominations` (JSON billets/pièces), `z_number` | FK `device`, `user`, `depot` |
| `CashMovement` | `kind` (IN, OUT), `amount`, `reason` | FK `session`, `user` |
| `Sale` | `receipt_number` (`C02-20261008-0047`), `status` (HELD, COMPLETED, CANCELLED), `channel` (COUNTER, ONLINE), `subtotal`, `discount_total`, `vat_total`, `total`, `paid_total`, `change_due`, `reprint_count` | FK `customer`, `cashier`, `register_session`, `depot`, `order` (nullable) |
| `SaleLine` | `quantity`, `unit_price`, `discount`, `line_total`, `price_kind` (RETAIL, WHOLESALE) | FK `sale`, `article` |
| `SaleLineKitAdjustment` | `action` (REMOVED, SUBSTITUTED), `quantity`, `price_delta` | FK `sale_line`, `component`, `substitute` |
| `Payment` | `amount`, `reference` | FK `sale`, `method` |
| `SaleReturn` + `SaleReturnLine` | `number`, `refund_mode` (CASH, CREDIT_NOTE), `quantity`, `amount` | FK `sale`, `sale_line`, `authorized_by` |
| `DiscountAuthorization` | `percent`, `reason` | FK `sale`, `requested_by`, `authorized_by` |

### orders (phase 7)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `OnlineOrder` | `number`, `status` (RECEIVED, CONFIRMED, PREPARING, READY, PICKED_UP, CANCELLED, EXPIRED), `pickup_slot`, `comment`, `pickup_code` (6 chiffres), `expires_at`, `total`, `deposit_paid` | FK `customer`, `pickup_depot`, `preparer`, `sale` (au retrait) |
| `OnlineOrderLine` | `quantity`, `unit_price`, `prepared_qty`, `status` (OK, PARTIAL, SUBSTITUTED, UNAVAILABLE) | FK `order`, `article`, `substitute` |
| `OrderStatusHistory` | `from_status`, `to_status`, `note` | FK `order`, `user` |
| `PaymentTransaction` | `provider`, `amount`, `status`, `external_ref` | FK `order` |

### notifications (phase 8)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `Notification` | `event`, `title`, `body`, `data` (JSON), `read_at` | FK `recipient` → User |
| `NotificationPreference` | `event`, `in_app`, `push`, `email`, `sms` | FK `user` |
| `PushSubscription` | `endpoint`, `p256dh`, `auth`, `user_agent` | FK `user`, `device` |

### sync (phase 4)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `SyncOperation` | `id` (UUID de l'opération outbox), `entity`, `operation`, `payload`, `client_timestamp`, `status` (OK, CONFLICT, ERROR), `result` | FK `device`, `user` — garantit l'idempotence |
| `SyncConflict` | `entity`, `entity_id`, `client_payload`, `server_payload`, `resolution` | FK `operation` |

### reports (phase 9)
| Modèle | Champs principaux | Relations |
|---|---|---|
| `ScheduledReport` | `report`, `frequency`, `recipients`, `filters` (JSON), `last_sent_at` | FK `created_by` |

## 4. Relations clés (vue d'ensemble)

```
Role ─< User >─ Device ─ Depot ─< Location
                 │
Category ─< Article ─< Barcode          Article ─1 KitDefinition ─< KitComponent >─ Article
                 │                                 └ SchoolLevel, School, SchoolYear
                 ├─< StockMovement >─ Depot         (stock = Σ mouvements)
                 ├─< SaleLine >─ Sale ─< Payment >─ PaymentMethod
                 │                 └─ CashRegisterSession ─ Device
                 ├─< OnlineOrderLine >─ OnlineOrder ─ Customer ─ User
                 ├─< PurchaseOrderLine >─ PurchaseOrder ─ Supplier
                 └─< InventoryCount >─ InventorySession
SyncOperation ─ Device / User        AuditLog ─ User / Device
```
