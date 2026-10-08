from celery import shared_task

from . import services


@shared_task
def expire_online_orders():
    """Commandes prêtes non retirées dans le délai : expirées, stock libéré."""
    return services.expire_due()


@shared_task
def remind_online_orders():
    """Rappel des commandes prêtes qui vont bientôt expirer."""
    return services.remind_due()
