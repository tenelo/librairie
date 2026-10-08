"""Opérations de caisse envoyées par les terminaux (en ligne comme hors ligne)."""
from apps.customers.models import Customer, School
from apps.sync.registry import register_pull, register_push
from apps.sync.services import last_writer_wins

from . import services
from .models import CashSession, CreditNote, PaymentMethod, Voucher


def _base(obj):
    return {"id": str(obj.pk), "sync_version": obj.sync_version, "is_deleted": obj.is_deleted}


def serialize_customer(obj: Customer):
    return {**_base(obj), "name": obj.name, "phone": obj.phone, "email": obj.email, "address": obj.address,
            "school": str(obj.school_id) if obj.school_id else None, "credit_limit": obj.credit_limit,
            "credit_balance": services.customer_balance(obj), "loyalty_points": services.loyalty_balance(obj),
            "is_active": obj.is_active}


CUSTOMER_FIELDS = ("name", "phone", "email", "address", "credit_limit", "notes", "is_active")


@register_push("sale", "create", permission="sales.create")
def push_sale(context, payload):
    sale = services.create_sale(context, payload)
    return {"sale": str(sale.pk), "receipt_number": sale.receipt_number, "total": sale.total,
            "loyalty_points": sale.loyalty_points}


@register_push("sale", "reprint", permission="sales.view")
def push_reprint(context, payload):
    sale = services.reprint(context, payload)
    return {"sale": str(sale.pk), "reprint_count": sale.reprint_count}


@register_push("sale_return", "create", permission="sales.return")
def push_return(context, payload):
    sale_return = services.create_return(context, payload)
    return {"return": str(sale_return.pk), "number": sale_return.number, "total": sale_return.total,
            "credit_note": sale_return.credit_note.number if sale_return.credit_note else None}


@register_push("cash_session", "open", permission="cash.open_close")
def push_open(context, payload):
    session = services.open_session(context, payload)
    return {"session": str(session.pk)}


@register_push("cash_session", "movement", permission="cash.open_close")
def push_cash_movement(context, payload):
    movement = services.cash_movement(context, payload)
    return {"movement": str(movement.pk)}


@register_push("cash_session", "close", permission="cash.open_close")
def push_close(context, payload):
    session = services.close_session(context, payload)
    return {"session": str(session.pk), "expected_cash": session.expected_cash, "variance": session.variance}


@register_push("customer", "create", permission="customers.manage")
def push_customer_create(context, payload):
    existing = Customer.all_objects.filter(pk=payload["id"]).first()
    if existing:
        return serialize_customer(existing)
    name = (payload.get("name") or "").strip()
    if not name:
        from rest_framework.exceptions import ValidationError

        raise ValidationError({"name": "Le nom du client est obligatoire."})
    customer = Customer.objects.create(
        id=payload["id"], name=name, phone=payload.get("phone", ""), email=payload.get("email", ""),
        address=payload.get("address", ""), school=School.objects.filter(pk=payload.get("school")).first()
        if payload.get("school") else None, device=context.device, client_timestamp=context.client_timestamp,
    )
    return serialize_customer(customer)


@register_push("customer", "update", permission="customers.manage")
def push_customer_update(context, payload):
    customer = Customer.all_objects.get(pk=payload["id"])
    changes = {k: v for k, v in (payload.get("changes") or {}).items() if k in CUSTOMER_FIELDS}
    return last_writer_wins(instance=customer, changes=changes, base_version=payload.get("base_version", 0),
                            client_timestamp=context.client_timestamp, context=context, serialize=serialize_customer)


@register_push("customer_account", "repay", permission="customers.manage")
def push_repay(context, payload):
    entry = services.repay(context, payload)
    return {"entry": str(entry.pk)}


def register_sales_sources():
    register_pull("customers", lambda: Customer.all_objects.all(), serialize_customer, "customers.view")
    register_pull("payment_methods", lambda: PaymentMethod.all_objects.all(),
                  lambda o: {**_base(o), "code": o.code, "label": o.label, "kind": o.kind,
                             "requires_reference": o.requires_reference, "is_active": o.is_active,
                             "sort_order": o.sort_order}, "sales.create")
    register_pull("cash_sessions", lambda: CashSession.all_objects.select_related("device", "opened_by"),
                  lambda o: {**_base(o), "device": str(o.device_id) if o.device_id else None,
                             "device_code": o.device.code if o.device_id else None, "depot": str(o.depot_id),
                             "status": o.status, "opened_at": o.opened_at, "opening_float": o.opening_float,
                             "opened_by": o.opened_by.username, "z_number": o.z_number}, "cash.open_close")
    register_pull("credit_notes", lambda: CreditNote.all_objects.all(),
                  lambda o: {**_base(o), "number": o.number, "remaining": o.remaining,
                             "customer": str(o.customer_id) if o.customer_id else None}, "sales.create")
    register_pull("vouchers", lambda: Voucher.all_objects.all(),
                  lambda o: {**_base(o), "code": o.code, "remaining": o.remaining, "is_active": o.is_active,
                             "expires_at": o.expires_at}, "sales.create")
