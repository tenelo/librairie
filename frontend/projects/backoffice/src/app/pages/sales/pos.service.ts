import { Injectable, inject } from '@angular/core';
import {
  AuthService,
  CartLine,
  CartPayment,
  DeviceService,
  LocalDbService,
  LocalRecord,
  NetworkStatusService,
  OfflineDataService,
  OutboxService,
  ReceiptData,
  ReceiptLibrary,
  StockDelta,
  SyncEngineService,
  SyncedRow,
  cartTotals,
  earnedPoints,
  lineTotal,
  receiptNumber,
  unitPrice,
} from '@librairie/shared';

export interface LocalSession {
  id: string;
  depot: string;
  opened_at: string;
  opening_float: number;
  opened_by: string;
}

export interface SaleDraft {
  lines: CartLine[];
  payments: CartPayment[];
  customer: SyncedRow | null;
  globalDiscount: number;
  loyaltyPointsUsed: number;
  discountAuthorizedBy: string | null;
  notes: string;
  /** Retrait d'une commande en ligne : la vente clôture la commande (contrôlée par le serveur). */
  onlineOrder?: string | null;
}

export interface LocalSale extends LocalRecord {
  receipt_number: string;
  cash_session: string | null;
  sold_at: string;
  total: number;
  payload: Record<string, unknown>;
  display: {
    cashier: string;
    device: string;
    customer: string | null;
    lines: { name: string; quantity: number; unitPrice: number; discount: number; total: number; details: string[] }[];
    payments: { label: string; amount: number; reference?: string }[];
    subtotal: number;
    discountTotal: number;
    change: number;
    loyaltyPoints: number;
  };
}

/**
 * Enregistrement des ventes sur le terminal : numérotation hors ligne, copie locale (historique,
 * réimpression, rapport Z), outbox avec les variations de stock, puis envoi immédiat si en ligne.
 */
@Injectable({ providedIn: 'root' })
export class PosService {
  private readonly local = inject(LocalDbService);
  private readonly outbox = inject(OutboxService);
  private readonly offline = inject(OfflineDataService);
  private readonly sync = inject(SyncEngineService);
  private readonly network = inject(NetworkStatusService);
  private readonly auth = inject(AuthService);
  private readonly devices = inject(DeviceService);

  async library(): Promise<ReceiptLibrary> {
    const settings = (await this.local.db.settings.toCollection().first()) ?? ({} as SyncedRow);
    const text = (key: string) => String(settings[key] ?? '');
    return {
      name: text('name') || 'Librairie', logo: (settings['logo'] as string | null) ?? null, address: text('address'),
      city: text('city'), phone: text('phone'), email: text('email'), taxpayer_number: text('taxpayer_number'),
      trade_register: text('trade_register'), receipt_header: text('receipt_header'),
      receipt_footer: text('receipt_footer'),
    };
  }

  async setting(key: string, fallback: number): Promise<number> {
    const settings = await this.local.db.settings.toCollection().first();
    return Number(settings?.[key] ?? fallback);
  }

  /** Séquence locale du jour pour ce terminal (stockée en base locale, transactionnelle). */
  async nextReceiptNumber(date = new Date()): Promise<string> {
    const device = this.devices.device()?.code;
    if (!device) {
      throw new Error('Ce poste n’est associé à aucun terminal : enregistrez-le dans Administration › Terminaux.');
    }
    const key = `receipt-seq-${device}-${date.toISOString().slice(0, 10)}`;
    let sequence = 0;
    await this.local.db.transaction('rw', this.local.db.meta, async () => {
      const current = Number((await this.local.db.meta.get(key))?.value ?? 0);
      sequence = current + 1;
      await this.local.db.meta.put({ key, value: sequence });
    });
    return receiptNumber(device, date, sequence);
  }

  /** Variations de stock locales d'une ligne (kit virtuel décomposé selon ses retraits / substitutions). */
  async lineDeltas(line: CartLine, depot: string): Promise<StockDelta[]> {
    if (line.article.type === 'KIT') {
      const kit = await this.local.db.kits.where('article').equals(line.article.id).first();
      if (kit && kit['stock_mode'] === 'VIRTUAL') {
        const components = await this.local.db.kit_components.where('kit').equals(kit.id).toArray();
        const deltas: StockDelta[] = [];
        for (const component of components) {
          if (line.kitAdjustments?.removed.includes(component.id)) {
            continue;
          }
          const article = line.kitAdjustments?.substitutions[component.id] ?? String(component['article']);
          deltas.push(...(await this.offline.stockDeltas(article, depot,
            -Number(component['quantity']) * line.quantity)));
        }
        return deltas;
      }
    }
    return this.offline.stockDeltas(line.article.id, depot, -line.quantity);
  }

  async completeSale(draft: SaleDraft, session: LocalSession, methodLabels: Map<string, string>): Promise<LocalSale> {
    const user = this.auth.user();
    const device = this.devices.device();
    if (!user || !device) {
      throw new Error('Session ou terminal manquant.');
    }
    const soldAt = new Date();
    const number = await this.nextReceiptNumber(soldAt);
    const pointValue = await this.setting('loyalty_point_value', 10);
    const pointsValue = draft.loyaltyPointsUsed * pointValue;
    const totals = cartTotals(draft.lines, draft.globalDiscount, pointsValue);
    const paid = draft.payments.reduce((sum, p) => sum + p.amount, 0);
    const change = paid - totals.total;
    const id = crypto.randomUUID();
    const payload = {
      id,
      receipt_number: number,
      depot: session.depot,
      cash_session: session.id,
      customer: draft.customer?.id ?? null,
      lines: draft.lines.map((line) => ({
        id: line.id, article: line.article.id, description: line.description, quantity: line.quantity,
        unit_price: unitPrice(line).price, discount: line.discount, line_total: lineTotal(line),
        kit_adjustments: line.kitAdjustments ?? undefined,
      })),
      subtotal: totals.subtotal,
      global_discount: draft.globalDiscount,
      loyalty_points_used: draft.loyaltyPointsUsed,
      total: totals.total,
      payments: draft.payments.map(({ method, amount, reference, voucher_code, credit_note_number }) =>
        ({ method, amount, reference, voucher_code, credit_note_number })),
      change_due: change,
      discount_authorized_by: draft.discountAuthorizedBy,
      notes: draft.notes,
      online_order: draft.onlineOrder ?? undefined,
    };
    const deltas = (await Promise.all(draft.lines.map((line) => this.lineDeltas(line, session.depot)))).flat();
    const perThousand = await this.setting('loyalty_points_per_1000', 1);
    const record: LocalSale = {
      id, createdAt: soldAt.getTime(), receipt_number: number, cash_session: session.id, sold_at: soldAt.toISOString(),
      total: totals.total, payload,
      display: {
        cashier: user.full_name, device: device.code, customer: draft.customer ? String(draft.customer['name']) : null,
        lines: draft.lines.map((line) => ({
          name: line.description, quantity: line.quantity, unitPrice: unitPrice(line).price, discount: line.discount,
          total: lineTotal(line), details: line.kitAdjustments ? kitDetails(line) : [],
        })),
        payments: draft.payments.map((p) => ({ label: methodLabels.get(p.method) ?? p.method, amount: p.amount,
          reference: p.reference })),
        subtotal: totals.gross, discountTotal: totals.lineDiscounts + totals.globalDiscount + pointsValue, change,
        loyaltyPoints: draft.customer ? earnedPoints(totals.total, perThousand) : 0,
      },
    };
    await this.local.db.transaction('rw', [this.local.db.local_sales, this.local.db.outbox], async () => {
      await this.local.db.local_sales.add(record);
      await this.outbox.enqueue('sale', 'create', payload, { stockDeltas: deltas,
        label: `Vente ${number} (${totals.total} FCFA)` });
    });
    await this.afterWrite();
    return record;
  }

  async reprint(sale: LocalSale | { id: string; receipt_number: string }): Promise<void> {
    await this.outbox.enqueue('sale', 'reprint', { sale: sale.id }, { label: `Réimpression ${sale.receipt_number}` });
    await this.afterWrite();
  }

  async afterWrite(): Promise<void> {
    await this.sync.refreshCounts();
    if (this.network.online()) {
      void this.sync.syncNow();
    } else {
      void this.sync.requestBackgroundSync();
    }
  }

  async receiptOf(sale: LocalSale, duplicate = false): Promise<ReceiptData> {
    return {
      title: 'Reçu', number: sale.receipt_number, date: sale.sold_at, cashier: sale.display.cashier,
      device: sale.display.device, customer: sale.display.customer, lines: sale.display.lines,
      subtotal: sale.display.subtotal, discountTotal: sale.display.discountTotal, total: sale.total,
      payments: sale.display.payments, change: sale.display.change, loyaltyPoints: sale.display.loyaltyPoints || null,
      duplicate, extra: [], qrValue: sale.receipt_number, library: await this.library(),
    };
  }
}

function kitDetails(line: CartLine): string[] {
  const details: string[] = [];
  if (line.kitAdjustments?.removed.length) {
    details.push(`${line.kitAdjustments.removed.length} article(s) retiré(s)`);
  }
  if (Object.keys(line.kitAdjustments?.substitutions ?? {}).length) {
    details.push(`${Object.keys(line.kitAdjustments!.substitutions).length} article(s) remplacé(s)`);
  }
  return details;
}
