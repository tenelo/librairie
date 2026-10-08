import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  APP_CONFIG,
  FcfaPipe,
  LocalDbService,
  NetworkStatusService,
  OutboxService,
  Paginated,
  PrinterService,
  ReceiptData,
  ReceiptFormat,
  RECEIPT_FORMAT_LABELS,
} from '@librairie/shared';

import { LocalSale, PosService } from './pos.service';

export interface ServerSale {
  id: string;
  receipt_number: string;
  status_label: string;
  customer_name: string | null;
  cashier_name: string;
  device_code: string | null;
  sold_at: string;
  subtotal: number;
  discount_total: number;
  total: number;
  change_due: number;
  reprint_count: number;
  loyalty_points: number;
  lines: { id: string; article: string; description: string; quantity: number; unit_price: number; discount: number;
    line_total: number; returnable: number; kit_adjustments: unknown[] }[];
  payments: { method_label: string; amount: number; reference: string }[];
}

/** Historique : ventes de ce terminal (disponibles hors ligne) et, en ligne, toutes les ventes. Réimpression DUPLICATA. */
@Component({
  selector: 'bo-history-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatButtonToggleModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Historique des ventes</h1>
      <mat-button-toggle-group [value]="scope()" (change)="setScope($event.value)" aria-label="Portée">
        <mat-button-toggle value="local">Ce terminal</mat-button-toggle>
        <mat-button-toggle value="server" [disabled]="!network.online()">Toutes les ventes</mat-button-toggle>
      </mat-button-toggle-group>
    </header>
    <div class="toolbar">
      <input type="search" [(ngModel)]="term" (keyup.enter)="load()" placeholder="N° de reçu, client" aria-label="Rechercher" />
      <select [value]="printer.format()" (change)="printer.setFormat($any($event.target).value)" aria-label="Format">
        @for (f of formats; track f) { <option [value]="f">{{ formatLabels[f] }}</option> }
      </select>
    </div>
    <table class="list">
      <thead><tr><th>Reçu</th><th>Date</th><th>Client</th><th class="num">Total</th><th>État</th><th></th></tr></thead>
      <tbody>
        @for (s of rows(); track s.id) {
          <tr>
            <td><strong>{{ s.number }}</strong><br /><small class="muted">{{ s.cashier }} · {{ s.device }}</small></td>
            <td>{{ s.date | date: 'dd/MM/yyyy HH:mm' }}</td>
            <td>{{ s.customer ?? '—' }}</td>
            <td class="num">{{ s.total | fcfa }}</td>
            <td>{{ s.state }}</td>
            <td class="num">
              <button mat-stroked-button type="button" (click)="reprint(s.id)"><mat-icon>print</mat-icon> Réimprimer</button>
              <a mat-icon-button [href]="whatsapp(s)" target="_blank" rel="noopener" aria-label="Envoyer par WhatsApp"
                 title="Envoyer le récapitulatif par WhatsApp"><mat-icon>share</mat-icon></a>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="6" class="empty">Aucune vente.</td></tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: './sales-page.scss',
})
export class HistoryPage {
  private readonly local = inject(LocalDbService);
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly pos = inject(PosService);
  private readonly outbox = inject(OutboxService);
  private readonly snack = inject(MatSnackBar);
  protected readonly printer = inject(PrinterService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly formatLabels = RECEIPT_FORMAT_LABELS;
  protected readonly formats = Object.keys(RECEIPT_FORMAT_LABELS) as ReceiptFormat[];

  protected readonly scope = signal<'local' | 'server'>('local');
  protected readonly rows = signal<{ id: string; number: string; date: string; customer: string | null; total: number;
    cashier: string; device: string; state: string }[]>([]);
  private serverSales = new Map<string, ServerSale>();
  private localSales = new Map<string, LocalSale>();
  protected term = '';

  constructor() {
    void this.load();
  }

  protected setScope(scope: 'local' | 'server'): void {
    this.scope.set(scope);
    void this.load();
  }

  protected async load(): Promise<void> {
    const term = this.term.trim().toLowerCase();
    if (this.scope() === 'local') {
      const pending = new Set((await this.outbox.all()).filter((e) => e.entity === 'sale' && e.operation === 'create')
        .map((e) => String(e.payload['id'])));
      const sales = (await this.local.db.local_sales.orderBy('createdAt').reverse().limit(500).toArray()) as LocalSale[];
      this.localSales = new Map(sales.map((s) => [s.id, s]));
      this.rows.set(sales.filter((s) => !term || s.receipt_number.toLowerCase().includes(term) ||
        (s.display.customer ?? '').toLowerCase().includes(term)).map((s) => ({
        id: s.id, number: s.receipt_number, date: s.sold_at, customer: s.display.customer, total: s.total,
        cashier: s.display.cashier, device: s.display.device, state: pending.has(s.id) ? 'À synchroniser' : 'Synchronisée',
      })));
      return;
    }
    this.http.get<Paginated<ServerSale>>(`${this.api}/sales/sales/`, { params: { search: term, page_size: 100 } })
      .subscribe((page) => {
        this.serverSales = new Map(page.results.map((s) => [s.id, s]));
        this.rows.set(page.results.map((s) => ({ id: s.id, number: s.receipt_number, date: s.sold_at,
          customer: s.customer_name, total: s.total, cashier: s.cashier_name, device: s.device_code ?? '',
          state: `${s.status_label}${s.reprint_count ? ` · ${s.reprint_count} réimpression(s)` : ''}` })));
      });
  }

  /** Récapitulatif du reçu à envoyer par WhatsApp (le caissier choisit le destinataire et envoie lui-même). */
  protected whatsapp(row: { number: string; date: string; total: number }): string {
    const text = `Votre reçu ${row.number} du ${new Date(row.date).toLocaleString('fr-CI')} : ` +
      `${new Intl.NumberFormat('fr-CI').format(row.total)} FCFA. Merci de votre visite !`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  protected async reprint(id: string): Promise<void> {
    let receipt: ReceiptData;
    const local = this.localSales.get(id);
    if (local) {
      receipt = await this.pos.receiptOf(local, true);
    } else {
      const sale = this.serverSales.get(id)!;
      receipt = {
        title: 'Reçu', number: sale.receipt_number, date: sale.sold_at, cashier: sale.cashier_name,
        device: sale.device_code ?? '', customer: sale.customer_name,
        lines: sale.lines.map((l) => ({ name: l.description, quantity: l.quantity, unitPrice: l.unit_price,
          discount: l.discount, total: l.line_total, details: l.kit_adjustments.length ? ['Kit personnalisé'] : [] })),
        subtotal: sale.subtotal, discountTotal: sale.discount_total, total: sale.total,
        payments: sale.payments.map((p) => ({ label: p.method_label, amount: p.amount, reference: p.reference })),
        change: sale.change_due, loyaltyPoints: sale.loyalty_points || null, duplicate: true, extra: [],
        qrValue: sale.receipt_number, library: await this.pos.library(),
      };
    }
    await this.pos.reprint({ id, receipt_number: receipt.number });
    await this.printer.print(receipt);
    this.snack.open(`Duplicata du reçu ${receipt.number} imprimé (réimpression tracée).`);
  }
}
