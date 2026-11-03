/** Commandes en ligne (click & collect), partagées par la boutique et le backoffice. */

export type OrderStatus = 'RECEIVED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'CANCELLED' | 'EXPIRED';
export type OrderLineStatus = 'OK' | 'PARTIAL' | 'SUBSTITUTED' | 'UNAVAILABLE';
export type Availability = 'IN_STOCK' | 'LOW' | 'OUT';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  RECEIVED: 'Reçue',
  CONFIRMED: 'Confirmée',
  PREPARING: 'En préparation',
  READY: 'Prête à retirer',
  PICKED_UP: 'Retirée',
  CANCELLED: 'Annulée',
  EXPIRED: 'Expirée',
};

/** Étapes affichées dans le suivi de commande (les branches annulée / expirée sont à part). */
export const ORDER_STEPS: OrderStatus[] = ['RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP'];

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  IN_STOCK: 'En stock',
  LOW: 'Stock faible',
  OUT: 'Indisponible',
};

export interface OrderLineProposal {
  quantity?: number;
  substitute?: string;
  substitute_name?: string;
  substitute_quantity?: number;
  unit_price?: number;
}

export interface OrderLine {
  id: string;
  article: string;
  code: string;
  description: string;
  ordered_qty: number;
  quantity: number;
  unit_price: number;
  line_total: number;
  prepared_qty: number;
  status: OrderLineStatus;
  status_label: string;
  proposal: OrderLineProposal;
  original_article: string | null;
}

export interface OrderHistoryEntry {
  from_status: string;
  to_status: OrderStatus;
  to_label: string;
  note: string;
  user_name?: string | null;
  at: string;
}

export interface OrderPayment {
  id: string;
  provider: string;
  operator: string;
  phone: string;
  amount: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  status_label: string;
  external_ref: string;
  message: string;
  created_at: string;
  completed_at: string | null;
}

export interface OnlineOrder {
  id: string;
  number: string;
  status: OrderStatus;
  status_label: string;
  customer?: string;
  customer_name?: string;
  customer_phone?: string;
  pickup_depot: string;
  pickup_depot_name: string;
  pickup_slot: string | null;
  comment: string;
  pickup_code: string;
  qr_payload: string;
  accept_partial: boolean;
  awaiting_customer: boolean;
  payment_mode: 'ON_PICKUP' | 'DEPOSIT';
  payment_mode_label: string;
  total: number;
  deposit_due: number;
  deposit_paid: number;
  balance_due: number;
  parcels?: number;
  preparer?: string | null;
  preparer_name?: string | null;
  sale?: string | null;
  sale_receipt: string | null;
  confirmed_at: string | null;
  ready_at: string | null;
  expires_at: string | null;
  picked_up_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
  lines: OrderLine[];
  history: OrderHistoryEntry[];
  payments: OrderPayment[];
}

export interface ShopArticle {
  id: string;
  code: string;
  name: string;
  description: string;
  type: string;
  category: string | null;
  category_path: string | null;
  brand_name: string | null;
  price: number;
  image: string | null;
  availability: Availability;
  /** Quantité commandable, plafonnée à 20 (null : illimitée). */
  available: number | null;
}

export interface ShopKit {
  id: string;
  article: ShopArticle;
  level: string;
  level_label: string;
  school: string | null;
  school_name: string | null;
  school_year_label: string | null;
  components: { name: string; quantity: number; is_optional: boolean }[];
}

export interface ShopReference {
  categories: { id: string; name: string; parent: string | null; path: string }[];
  schools: { id: string; name: string; city: string }[];
  levels: { id: string; code: string; label: string; cycle: string }[];
  pickup_points: { id: string; code: string; name: string; address: string }[];
  operators: { code: string; label: string }[];
  sandbox_payments: boolean;
}

/** Contenu du QR code de retrait : `CMD:{numéro}:{code à 6 chiffres}`. */
export function parsePickupCode(raw: string): { number: string | null; code: string | null } {
  const value = raw.trim().toUpperCase();
  const qr = /^CMD:([A-Z0-9-]+):(\d{6})$/.exec(value);
  if (qr) {
    return { number: qr[1], code: qr[2] };
  }
  if (/^\d{6}$/.test(value)) {
    return { number: null, code: value };
  }
  return { number: value || null, code: null };
}
