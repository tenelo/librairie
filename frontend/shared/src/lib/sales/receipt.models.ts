export type ReceiptFormat = 'THERMAL_58' | 'THERMAL_80' | 'A5' | 'A4';

export const RECEIPT_FORMAT_LABELS: Record<ReceiptFormat, string> = {
  THERMAL_58: 'Ticket 58 mm',
  THERMAL_80: 'Ticket 80 mm',
  A5: 'Facture A5',
  A4: 'Facture A4',
};

export interface ReceiptLibrary {
  name: string;
  logo: string | null;
  address: string;
  city: string;
  phone: string;
  email: string;
  taxpayer_number: string;
  trade_register: string;
  receipt_header: string;
  receipt_footer: string;
}

export interface ReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  details: string[];
}

export interface ReceiptData {
  title: string;
  number: string;
  date: string;
  cashier: string;
  device: string;
  customer: string | null;
  lines: ReceiptLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  payments: { label: string; amount: number; reference?: string }[];
  change: number;
  loyaltyPoints: number | null;
  duplicate: boolean;
  /** Lignes libres (rapport Z, retour…) affichées après les totaux. */
  extra: { label: string; value: string }[];
  qrValue: string | null;
  library: ReceiptLibrary;
}
