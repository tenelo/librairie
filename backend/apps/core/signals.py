"""Événements métier transverses (les notifications s'y abonnent sans coupler les applications).

`business_event.send(sender, event=..., instance=..., user=...)` :
- `cash_session_closed` (instance : CashSession) ;
- `sync_operation_failed` (instance : SyncOperation) ;
- `inventory_to_review` (instance : InventorySession).
"""
from django.dispatch import Signal

business_event = Signal()
