export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Brouillon',
  SENT: 'Envoyé',
  PARTIAL: 'Partiellement reçu',
  RECEIVED: 'Reçu',
  CANCELLED: 'Annulé',
};

export interface Supplier {
  id: string;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  payment_terms: string;
  lead_time_days: number;
  notes: string;
  is_active: boolean;
  order_count: number;
}

export interface PurchaseOrderLine {
  id?: string;
  article: string;
  article_code?: string;
  article_name?: string;
  quantity: number;
  unit_cost: number;
  received_quantity?: number;
  remaining?: number;
  amount?: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplier: string;
  supplier_name: string;
  depot: string;
  depot_code: string;
  status: PurchaseOrderStatus;
  status_label: string;
  order_date: string;
  expected_date: string | null;
  note: string;
  lines: PurchaseOrderLine[];
  total: number;
  created_by_name: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface PurchaseOrderInput {
  supplier: string;
  depot: string;
  order_date: string;
  expected_date: string | null;
  note: string;
  lines: { article: string; quantity: number; unit_cost: number }[];
}

export interface GoodsReceiptLine {
  id?: string;
  article: string;
  article_code?: string;
  article_name?: string;
  order_line?: string | null;
  quantity: number;
  unit_cost: number;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  supplier: string;
  supplier_name: string;
  depot: string;
  depot_code: string;
  purchase_order: string | null;
  purchase_order_number: string | null;
  received_at: string;
  delivery_note: string;
  note: string;
  lines: GoodsReceiptLine[];
  total: number;
  user_name: string | null;
  created_at: string;
}

export interface GoodsReceiptInput {
  id?: string;
  supplier: string;
  depot: string;
  purchase_order: string | null;
  delivery_note: string;
  note: string;
  lines: { article: string; order_line: string | null; quantity: number; unit_cost: number }[];
}

export interface ReorderSuggestion {
  article: string;
  article_code: string;
  article_name: string;
  available: number;
  on_order: number;
  daily_sales: number;
  reorder_point: number;
  alert_threshold: number;
  max_stock: number | null;
  suggested_quantity: number;
  supplier: string | null;
  supplier_name: string | null;
  unit_cost: number;
}
