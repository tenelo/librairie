import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  APP_CONFIG,
  FcfaPipe,
  LocalDbService,
  NetworkStatusService,
  OutboxService,
  Paginated,
  SyncEngineService,
  SyncedRow,
  apiErrorMessage,
} from '@librairie/shared';

import { CashRegisterService } from '../sales/cash-register.service';

interface Voucher {
  id: string;
  code: string;
  customer_name: string | null;
  amount: number;
  remaining: number;
  expires_at: string | null;
}

interface CreditNote {
  id: string;
  number: string;
  customer_name: string | null;
  amount: number;
  remaining: number;
}

/** Crédits clients (encours, règlements), avoirs et bons d'achat. */
@Component({
  selector: 'bo-credits-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Crédits et avoirs</h1>
    <div class="card">
      <h2>Clients avec un encours</h2>
      <table class="list">
        <thead><tr><th>Client</th><th class="num">Encours</th><th>Règlement</th></tr></thead>
        <tbody>
          @for (c of debtors(); track c.id) {
            <tr>
              <td>{{ c['name'] }} <small class="muted">{{ c['phone'] }}</small></td>
              <td class="num">{{ $any(c['credit_balance']) | fcfa }}</td>
              <td class="form-row">
                <input type="number" min="1" placeholder="Montant" [(ngModel)]="amounts[c.id]" aria-label="Montant réglé" />
                <select [(ngModel)]="methods[c.id]" aria-label="Moyen de paiement">
                  <option value="CASH">Espèces</option><option value="ORANGE_MONEY">Orange Money</option>
                  <option value="MTN_MOMO">MTN MoMo</option><option value="MOOV_MONEY">Moov Money</option><option value="WAVE">Wave</option>
                </select>
                <button mat-stroked-button type="button" (click)="repay(c)" [disabled]="!amounts[c.id]">Encaisser</button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="3" class="empty">Aucun encours client.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Bons d'achat</h2>
      @if (network.online()) {
        <div class="form-row">
          <input type="number" min="1" placeholder="Montant (FCFA)" [(ngModel)]="voucherAmount" aria-label="Montant du bon" />
          <input type="date" [(ngModel)]="voucherExpiry" aria-label="Date de validité" />
          <button mat-flat-button type="button" (click)="createVoucher()" [disabled]="!voucherAmount"><mat-icon>card_giftcard</mat-icon> Émettre un bon</button>
        </div>
      }
      <table class="list">
        <thead><tr><th>Code</th><th>Client</th><th class="num">Montant</th><th class="num">Solde</th><th>Validité</th></tr></thead>
        <tbody>
          @for (v of vouchers(); track v.id) {
            <tr><td><code>{{ v.code }}</code></td><td>{{ v.customer_name ?? '—' }}</td><td class="num">{{ v.amount | fcfa }}</td>
              <td class="num">{{ v.remaining | fcfa }}</td><td>{{ v.expires_at ? (v.expires_at | date: 'dd/MM/yyyy') : '—' }}</td></tr>
          } @empty { <tr><td colspan="5" class="empty">Aucun bon d'achat.</td></tr> }
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Avoirs</h2>
      <table class="list">
        <thead><tr><th>Numéro</th><th>Client</th><th class="num">Montant</th><th class="num">Solde</th></tr></thead>
        <tbody>
          @for (n of creditNotes(); track n.id) {
            <tr><td><code>{{ n.number }}</code></td><td>{{ n.customer_name ?? '—' }}</td><td class="num">{{ n.amount | fcfa }}</td>
              <td class="num">{{ n.remaining | fcfa }}</td></tr>
          } @empty { <tr><td colspan="4" class="empty">Aucun avoir.</td></tr> }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `.form-row input, .form-row select { width: 130px; font: inherit; padding: 6px; }`,
})
export class CreditsPage {
  private readonly local = inject(LocalDbService);
  private readonly outbox = inject(OutboxService);
  private readonly sync = inject(SyncEngineService);
  private readonly register = inject(CashRegisterService);
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);

  protected readonly debtors = signal<SyncedRow[]>([]);
  protected readonly vouchers = signal<Voucher[]>([]);
  protected readonly creditNotes = signal<CreditNote[]>([]);
  protected amounts: Record<string, number> = {};
  protected methods: Record<string, string> = {};
  protected voucherAmount = 0;
  protected voucherExpiry = '';

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.debtors.set(await this.local.db.customers.filter((c) => Number(c['credit_balance'] ?? 0) > 0).toArray());
    if (this.network.online()) {
      this.http.get<Paginated<Voucher>>(`${this.api}/sales/vouchers/`).subscribe((p) => this.vouchers.set(p.results));
      this.http.get<Paginated<CreditNote>>(`${this.api}/sales/credit-notes/`).subscribe((p) => this.creditNotes.set(p.results));
    }
  }

  protected async repay(customer: SyncedRow): Promise<void> {
    const amount = Number(this.amounts[customer.id]);
    const method = this.methods[customer.id] ?? 'CASH';
    if (method === 'CASH' && !this.register.current()) {
      this.snack.open('Un règlement en espèces exige une caisse ouverte.', 'Fermer');
      return;
    }
    await this.outbox.enqueue('customer_account', 'repay', { id: crypto.randomUUID(), customer: customer.id, amount,
      method, cash_session: this.register.current()?.id ?? null }, { label: `Règlement ${customer['name']} ${amount} FCFA` });
    await this.local.db.customers.put({ ...customer, credit_balance: Number(customer['credit_balance']) - amount });
    this.amounts[customer.id] = 0;
    await this.sync.refreshCounts();
    void this.sync.syncNow();
    this.snack.open('Règlement enregistré.');
    await this.load();
  }

  protected createVoucher(): void {
    this.http.post<Voucher>(`${this.api}/sales/vouchers/`, { amount: Number(this.voucherAmount),
      expires_at: this.voucherExpiry || null }).subscribe({
      next: (voucher) => {
        this.snack.open(`Bon ${voucher.code} émis.`);
        this.voucherAmount = 0;
        void this.load();
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
    });
  }
}
