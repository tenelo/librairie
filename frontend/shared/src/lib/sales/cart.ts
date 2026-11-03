/**
 * Calculs de caisse (panier, remises, paiements, monnaie), identiques aux contrôles du serveur
 * (`apps/sales/services.py`) : une vente calculée ici, même hors ligne, est acceptée telle quelle.
 */
import { roundHalfUp } from '../format/money';

export type PriceKind = 'RETAIL' | 'WHOLESALE';

export interface PricedArticle {
  id: string;
  code: string;
  name: string;
  type: string;
  retail_price: number;
  wholesale_price: number | null;
  wholesale_min_qty: number | null;
  avg_cost: number;
}

export interface KitAdjustmentsInput {
  removed: string[];
  substitutions: Record<string, string>;
}

export interface CartLine {
  id: string;
  article: PricedArticle;
  quantity: number;
  /** Prix unitaire imposé (kit personnalisé) ; sinon prix catalogue détail ou gros. */
  customPrice: number | null;
  discount: number;
  kitAdjustments: KitAdjustmentsInput | null;
  description: string;
}

export interface CartPayment {
  method: string;
  kind: string;
  amount: number;
  reference?: string;
  voucher_code?: string;
  credit_note_number?: string;
}

export function unitPrice(line: CartLine): { price: number; kind: PriceKind } {
  if (line.customPrice !== null) {
    return { price: line.customPrice, kind: 'RETAIL' };
  }
  const { wholesale_price: wholesale, wholesale_min_qty: threshold } = line.article;
  if (wholesale !== null && threshold && line.quantity >= threshold) {
    return { price: wholesale, kind: 'WHOLESALE' };
  }
  return { price: line.article.retail_price, kind: 'RETAIL' };
}

export function lineGross(line: CartLine): number {
  return line.quantity * unitPrice(line).price;
}

export function lineTotal(line: CartLine): number {
  return lineGross(line) - line.discount;
}

export interface CartTotals {
  gross: number;
  lineDiscounts: number;
  subtotal: number;
  globalDiscount: number;
  pointsValue: number;
  total: number;
  /** Remise totale en % du brut (comparée au plafond du rôle ; hors points de fidélité). */
  discountPercent: number;
}

export function cartTotals(lines: CartLine[], globalDiscount = 0, pointsValue = 0): CartTotals {
  const gross = lines.reduce((sum, line) => sum + lineGross(line), 0);
  const lineDiscounts = lines.reduce((sum, line) => sum + line.discount, 0);
  const subtotal = gross - lineDiscounts;
  const total = Math.max(subtotal - globalDiscount - pointsValue, 0);
  const discountPercent = gross ? ((lineDiscounts + globalDiscount) * 100) / gross : 0;
  return { gross, lineDiscounts, subtotal, globalDiscount, pointsValue, total, discountPercent };
}

export interface PaymentCheck {
  paid: number;
  cash: number;
  change: number;
  remaining: number;
  valid: boolean;
  error: string | null;
}

/** Règles du serveur : paiement suffisant, monnaie rendue uniquement sur les espèces, références saisies. */
export function checkPayments(total: number, payments: CartPayment[], requiresReference: (method: string) => boolean,
  hasCustomer: boolean): PaymentCheck {
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const cash = payments.filter((p) => p.kind === 'CASH').reduce((sum, p) => sum + p.amount, 0);
  const change = Math.max(paid - total, 0);
  const remaining = Math.max(total - paid, 0);
  let error: string | null = null;
  if (payments.some((p) => p.amount <= 0)) {
    error = 'Montant de paiement invalide.';
  } else if (remaining > 0) {
    error = `Reste à payer : ${remaining} FCFA.`;
  } else if (change > cash) {
    error = 'La monnaie ne peut être rendue que sur un paiement en espèces.';
  } else if (payments.some((p) => requiresReference(p.method) && !p.reference?.trim())) {
    error = 'Saisissez la référence de la transaction Mobile Money / carte.';
  } else if (payments.some((p) => p.kind === 'CREDIT') && !hasCustomer) {
    error = 'Une vente à crédit exige un client.';
  }
  return { paid, cash, change, remaining, valid: error === null, error };
}

/** Numéro de reçu hors ligne : {CODE_TERMINAL}-{AAAAMMJJ}-{séquence sur 4 chiffres}. */
export function receiptNumber(deviceCode: string, date: Date, sequence: number): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${deviceCode}-${y}${m}${d}-${String(sequence).padStart(4, '0')}`;
}

/** Points gagnés : tranche de 1 000 FCFA × points par tranche (règle serveur). */
export function earnedPoints(total: number, perThousand: number): number {
  return Math.floor(total / 1000) * perThousand;
}

/** Montant d'un retour au prorata de la ligne, remise globale de la vente répartie. */
export function returnAmount(lineTotalValue: number, lineQuantity: number, quantity: number, saleTotal: number,
  saleSubtotal: number): number {
  const ratio = saleSubtotal ? saleTotal / saleSubtotal : 1;
  return roundHalfUp((lineTotalValue * quantity * ratio) / lineQuantity);
}

/** Coupures FCFA pour le comptage de clôture. */
export const FCFA_DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10, 5];

export function countDenominations(counts: Record<string, number>): number {
  return Object.entries(counts).reduce((sum, [value, count]) => sum + Number(value) * (Number(count) || 0), 0);
}
