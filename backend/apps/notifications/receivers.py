"""Abonnements aux événements métier : traduction en notifications pour le personnel et les clients."""
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.core.signals import business_event
from apps.orders.models import OnlineOrder
from apps.orders.services import order_event
from apps.stock.models import StockAlert

from .services import notify, notify_staff


def _fcfa(amount) -> str:
    return f"{int(amount):,}".replace(",", " ") + " FCFA"


@receiver(order_event, sender=OnlineOrder, dispatch_uid="notifications-order-event")
def on_order_event(sender, order: OnlineOrder, event: str, user=None, **kwargs):
    customer = order.customer.user
    staff_url = f"/commandes/detail/{order.pk}"
    shop_url = f"/mes-commandes/{order.pk}"
    number = order.number
    if event == "placed":
        notify_staff("order_placed", title=f"Nouvelle commande {number}",
                     body=f"{order.customer.name} · {_fcfa(order.total)} · retrait à {order.pickup_depot.name}",
                     url=staff_url, data={"order": str(order.pk)})
    elif event == "confirmed":
        notify("order_confirmed", [customer], title=f"Commande {number} confirmée",
               body="Nous préparons vos articles ; vous serez prévenu dès qu'elle sera prête.", url=shop_url)
    elif event == "preparing":
        notify("order_preparing", [customer], title=f"Commande {number} en préparation", url=shop_url)
    elif event == "approval_requested":
        notify("order_approval", [customer], title=f"Commande {number} : votre accord est nécessaire",
               body="Un article manque : consultez la proposition de la librairie.", url=shop_url)
    elif event == "approval_answered":
        notify_staff("order_approval_answered", title=f"Commande {number} : modification acceptée",
                     body=f"{order.customer.name} accepte la proposition.", url=staff_url)
    elif event == "ready":
        expires = order.expires_at.strftime("%d/%m à %H:%M") if order.expires_at else ""
        notify("order_ready", [customer], title=f"Commande {number} prête à retirer",
               body=f"Code de retrait {order.pickup_code} · {order.pickup_depot.name}"
                    + (f" · à retirer avant le {expires}" if expires else "")
                    + (f" · reste à payer {_fcfa(order.balance_due)}" if order.balance_due else ""),
               url=shop_url)
    elif event == "cancelled":
        if customer is not None and user is not None and user.pk == customer.pk:
            notify_staff("order_cancelled_by_customer", title=f"Commande {number} annulée par le client",
                         body=order.cancel_reason, url=staff_url)
        else:
            notify("order_cancelled", [customer], title=f"Commande {number} annulée",
                   body=order.cancel_reason or "Contactez la librairie pour plus d'informations.", url=shop_url)
    elif event == "expired":
        notify("order_expired", [customer], title=f"Commande {number} expirée",
               body="Le délai de retrait est dépassé : les articles ont été remis en rayon.", url=shop_url)
    elif event == "reminder":
        expires = order.expires_at.strftime("%d/%m à %H:%M") if order.expires_at else ""
        notify("order_reminder", [customer], title=f"Rappel : commande {number} à retirer",
               body=f"Votre commande vous attend jusqu'au {expires} (code {order.pickup_code}).", url=shop_url)
        notify_staff("order_expiring", title=f"Commande {number} bientôt expirée",
                     body=f"{order.customer.name} · expire le {expires}", url=staff_url)
    elif event == "deposit_paid":
        notify("deposit_paid", [customer], title=f"Acompte reçu pour {number}",
               body=f"Montant payé : {_fcfa(order.deposit_paid)}.", url=shop_url)


@receiver(post_save, sender=StockAlert, dispatch_uid="notifications-stock-alert")
def on_stock_alert(sender, instance: StockAlert, created, **kwargs):
    if not created:
        return
    label = "Rupture de stock" if instance.kind == StockAlert.Kind.OUT else "Stock bas"
    notify_staff("stock_low", title=f"{label} : {instance.article.name}",
                 body=f"Disponible {instance.available} (seuil {instance.threshold}).", url="/stock/alertes",
                 data={"article": str(instance.article_id)})


@receiver(business_event, dispatch_uid="notifications-business-event")
def on_business_event(sender, event: str, instance, user=None, **kwargs):
    if event == "cash_session_closed" and instance.variance:
        sign = "excédent" if instance.variance > 0 else "manque"
        notify_staff("cash_variance", title=f"Écart de caisse ({sign} de {_fcfa(abs(instance.variance))})",
                     body=f"Clôture {instance.z_number or ''} par {user.get_full_name() if user else '?'} · "
                          f"attendu {_fcfa(instance.expected_cash)}, compté {_fcfa(instance.counted_cash)}",
                     url="/caisse/rapports-z", exclude=None)
    elif event == "sync_operation_failed":
        device = instance.device.code if instance.device_id else "terminal inconnu"
        notify_staff("sync_error", title=f"Synchronisation rejetée ({device})",
                     body=f"{instance.entity}.{instance.operation} : {instance.error}"[:500], url="/synchronisation/file")
    elif event == "inventory_to_review":
        notify_staff("inventory_review", title=f"Inventaire {instance.number} à valider",
                     body=f"{instance.name} : comptages terminés.", url=f"/inventaires/sessions/{instance.pk}",
                     exclude=user)
