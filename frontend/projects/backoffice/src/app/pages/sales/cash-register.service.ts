import { Injectable, inject, signal } from '@angular/core';
import {
  AuthService,
  DeviceService,
  LocalDbService,
  OutboxService,
  ReceiptData,
} from '@librairie/shared';

import { LocalSale, LocalSession, PosService } from './pos.service';

const SESSION_KEY = 'cash-session';

export interface LocalZReport {
  session: LocalSession;
  salesCount: number;
  salesTotal: number;
  discountTotal: number;
  byMethod: { label: string; total: number }[];
  cashPayments: number;
  changeGiven: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  firstReceipt: string | null;
  lastReceipt: string | null;
}

/** Calcul local du rapport Z (même formule que le serveur), utilisable hors connexion. */
export function computeZ(session: LocalSession, sales: LocalSale[], cashRefunds: number,
  movements: { kind: string; amount: number }[]): LocalZReport {
  const byMethod = new Map<string, number>();
  let cashPayments = 0;
  for (const sale of sales) {
    for (const payment of sale.display.payments) {
      byMethod.set(payment.label, (byMethod.get(payment.label) ?? 0) + payment.amount);
    }
    for (const payment of (sale.payload['payments'] as { method: string; amount: number }[])) {
      if (payment.method === 'CASH') {
        cashPayments += payment.amount;
      }
    }
  }
  const changeGiven = sales.reduce((sum, s) => sum + s.display.change, 0);
  const cashIn = movements.filter((m) => m.kind === 'IN').reduce((sum, m) => sum + m.amount, 0);
  const cashOut = movements.filter((m) => m.kind === 'OUT').reduce((sum, m) => sum + m.amount, 0);
  const receipts = sales.map((s) => s.receipt_number).sort();
  return {
    session,
    salesCount: sales.length,
    salesTotal: sales.reduce((sum, s) => sum + s.total, 0),
    discountTotal: sales.reduce((sum, s) => sum + s.display.discountTotal, 0),
    byMethod: [...byMethod.entries()].map(([label, total]) => ({ label, total })),
    cashPayments,
    changeGiven,
    cashRefunds,
    cashIn,
    cashOut,
    expectedCash: session.opening_float + cashPayments - changeGiven - cashRefunds + cashIn - cashOut,
    firstReceipt: receipts[0] ?? null,
    lastReceipt: receipts.at(-1) ?? null,
  };
}

/** Ouverture, mouvements d'espèces et clôture de la caisse de ce terminal (hors connexion possible). */
@Injectable({ providedIn: 'root' })
export class CashRegisterService {
  private readonly local = inject(LocalDbService);
  private readonly outbox = inject(OutboxService);
  private readonly auth = inject(AuthService);
  private readonly devices = inject(DeviceService);
  private readonly pos = inject(PosService);

  readonly current = signal<LocalSession | null>(null);

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<LocalSession | null> {
    let session = await this.local.getMeta<LocalSession | null>(SESSION_KEY, null);
    if (!session) {
      // Caisse ouverte sur ce terminal avant une réinitialisation des données locales.
      const code = this.devices.device()?.code;
      const open = code ? (await this.local.db.cash_sessions.toArray()).find((s) =>
        s['status'] === 'OPEN' && s['device_code'] === code) : undefined;
      if (open) {
        session = { id: open.id, depot: String(open['depot']), opened_at: String(open['opened_at']),
          opening_float: Number(open['opening_float']), opened_by: String(open['opened_by']) };
        await this.local.setMeta(SESSION_KEY, session);
      }
    }
    this.current.set(session);
    return session;
  }

  async open(depot: string, openingFloat: number): Promise<LocalSession> {
    const session: LocalSession = { id: crypto.randomUUID(), depot, opened_at: new Date().toISOString(),
      opening_float: openingFloat, opened_by: this.auth.user()?.full_name ?? '' };
    await this.outbox.enqueue('cash_session', 'open', { id: session.id, depot, opening_float: openingFloat },
      { label: `Ouverture de caisse (fond ${openingFloat} FCFA)` });
    await this.local.setMeta(SESSION_KEY, session);
    this.current.set(session);
    await this.pos.afterWrite();
    return session;
  }

  async movement(kind: 'IN' | 'OUT', amount: number, reason: string): Promise<void> {
    const session = this.current();
    if (!session) {
      throw new Error('Aucune caisse ouverte.');
    }
    const id = crypto.randomUUID();
    await this.local.db.local_cash_movements.add({ id, createdAt: Date.now(), session: session.id, kind, amount, reason });
    await this.outbox.enqueue('cash_session', 'movement', { id, session: session.id, kind, amount, reason },
      { label: `${kind === 'IN' ? 'Entrée' : 'Sortie'} d'espèces ${amount} FCFA` });
    await this.pos.afterWrite();
  }

  async localZ(session: LocalSession): Promise<LocalZReport> {
    const sales = (await this.local.db.local_sales.where('cash_session').equals(session.id).toArray()) as LocalSale[];
    const returns = (await this.local.db.local_returns.toArray()).filter((r) => r['cash_session'] === session.id &&
      r['refund_mode'] === 'CASH');
    const movements = (await this.local.db.local_cash_movements.where('session').equals(session.id).toArray())
      .map((m) => ({ kind: String(m['kind']), amount: Number(m['amount']) }));
    return computeZ(session, sales, returns.reduce((sum, r) => sum + Number(r['total'] ?? 0), 0), movements);
  }

  async close(counted: number, denominations: Record<string, number>, notes: string): Promise<{ z: LocalZReport;
    zNumber: string; counted: number }> {
    const session = this.current();
    if (!session) {
      throw new Error('Aucune caisse ouverte.');
    }
    const z = await this.localZ(session);
    const now = new Date();
    const zNumber = `Z-${this.devices.device()?.code}-${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    await this.outbox.enqueue('cash_session', 'close', { session: session.id, counted_cash: counted, denominations,
      z_number: zNumber, notes }, { label: `Clôture de caisse ${zNumber}` });
    await this.local.setMeta(SESSION_KEY, null);
    await this.local.db.local_cash_movements.add({ id: crypto.randomUUID(), createdAt: Date.now(),
      session: session.id, kind: 'CLOSE', amount: counted, reason: zNumber });
    this.current.set(null);
    await this.pos.afterWrite();
    return { z, zNumber, counted };
  }

  async zReceipt(z: LocalZReport, zNumber: string, counted: number | null): Promise<ReceiptData> {
    const fmt = (v: number) => `${new Intl.NumberFormat('fr-CI').format(v)} FCFA`;
    const extra = [
      { label: 'Fond de caisse', value: fmt(z.session.opening_float) },
      { label: 'Ventes', value: `${z.salesCount} (${fmt(z.salesTotal)})` },
      { label: 'Remises accordées', value: fmt(z.discountTotal) },
      ...z.byMethod.map((m) => ({ label: m.label, value: fmt(m.total) })),
      { label: 'Monnaie rendue', value: fmt(z.changeGiven) },
      { label: 'Remboursements espèces', value: fmt(z.cashRefunds) },
      { label: "Entrées d'espèces", value: fmt(z.cashIn) },
      { label: "Sorties d'espèces", value: fmt(z.cashOut) },
      { label: 'Espèces attendues', value: fmt(z.expectedCash) },
    ];
    if (counted !== null) {
      extra.push({ label: 'Espèces comptées', value: fmt(counted) },
        { label: 'Écart', value: fmt(counted - z.expectedCash) });
    }
    extra.push({ label: 'Reçus', value: z.firstReceipt ? `${z.firstReceipt} → ${z.lastReceipt}` : '—' });
    return {
      title: 'RAPPORT Z', number: zNumber, date: new Date().toISOString(), cashier: this.auth.user()?.full_name ?? '',
      device: this.devices.device()?.code ?? '', customer: null, lines: [], subtotal: z.salesTotal, discountTotal: 0,
      total: z.salesTotal, payments: [], change: 0, loyaltyPoints: null, duplicate: false, extra, qrValue: null,
      library: await this.pos.library(),
    };
  }
}
