from django.apps import AppConfig


class SyncConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.sync"
    verbose_name = "Synchronisation"

    def ready(self):
        # Sources descendantes et gestionnaires d'opérations des applications déjà livrées.
        from apps.audit import sync_handlers as audit_handlers  # noqa: F401
        from apps.purchasing import sync_handlers as purchasing_handlers  # noqa: F401
        from apps.inventory import sync_handlers as inventory_handlers
        from apps.orders import sync_handlers as order_handlers
        from apps.sales import sync_handlers as sales_handlers
        from apps.stock import sync_handlers as stock_handlers  # noqa: F401

        from .pull_sources import register_core_sources

        register_core_sources()
        sales_handlers.register_sales_sources()
        inventory_handlers.register_inventory_sources()
        order_handlers.register_order_sources()
