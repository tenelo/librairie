import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  APP_CONFIG,
  AuthService,
  DeviceService,
  FcfaPipe,
  LocalDbService,
  NetworkStatusService,
  OutboxService,
  PrinterService,
  returnAmount,
} from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

import { CashRegisterService } from './cash-register.service';
import { ServerSale } from './history.page';
import { ManagerAuthDialogComponent } from './manager-auth-dialog.component';
import { LocalSale, PosService } from './pos.service';

interface ReturnableLine {
  id: string;
  article: string;
  description: string;
  quantity: number;
  lineTotal: number;
  returnable: number;
  kitAdjustments: unknown;
  toReturn: number;
}

interface FoundSale {
  id: string;
  number: string;
  total: number;
  subtotal: number;
  depot: string | null;
  lines: ReturnableLine[];
}

/** Retour partiel ou total à partir du numéro de reçu (saisi ou scanné sur le QR code du reçu). */
@Component({
  selector: 'bo-returns-page',
  imports: [FormsModule, MatButtonModule, MatButtonToggleModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Retours</h1>
    <div class="toolbar">
      <input type="search" [(ngModel)]="number" (keydown.enter)="find()" placeholder="Numéro de reçu ou scan du QR code"
             aria-label="Numéro de reçu" autofocus />
      <button mat-flat-button type="button" (click)="find()"><mat-icon>search</mat-icon> Rechercher</button>
    </div>
    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (sale(); as s) {
      <div class="card">
        <h2>Reçu {{ s.number }} — {{ s.total | fcfa }}</h2>
        <table class="list">
          <thead><tr><th>Article</th><th class="num">Vendu</th><th class="num">Retournable</th><th class="num">À retourner</th></tr></thead>
          <tbody>
            @for (line of s.lines; track line.id; let i = $index) {
              <tr>
                <td>{{ line.description }}</td>
                <td class="num">{{ line.quantity }}</td>
                <td class="num">{{ line.returnable }}</td>
                <td class="num"><input type="number" min="0" [max]="line.returnable" [value]="line.toReturn"
                                       (change)="setQty(i, $any($event.target).value)" [attr.aria-label]="'Retour ' + line.description" /></td>
              </tr>
            }
          </tbody>
        </table>
        <div class="form-row">
          <mat-button-toggle-group [value]="mode()" (change)="mode.set($event.value)" aria-label="Remboursement">
            <mat-button-toggle value="CASH">Remboursement en espèces</mat-button-toggle>
            <mat-button-toggle value="CREDIT_NOTE">Avoir</mat-button-toggle>
          </mat-button-toggle-group>
          <input type="text" [(ngModel)]="reason" placeholder="Motif du retour" aria-label="Motif" />
        </div>
        <p><strong>À rembourser : {{ refund() | fcfa }}</strong></p>
        <button mat-flat-button type="button" (click)="submit()" [disabled]="!refund() || !reason.trim() || busy()">
          <mat-icon>assignment_return</mat-icon> Valider le retour (autorisation responsable)
        </button>
      </div>
    }
  `,
  styleUrl: './sales-page.scss',
  styles: `td input { width: 70px; font: inherit; padding: 4px; } .form-row input { flex: 1; min-width: 200px; font: inherit; padding: 8px; }`,
})
export class ReturnsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly local = inject(LocalDbService);
  private readonly outbox = inject(OutboxService);
  private readonly offlineNetwork = inject(NetworkStatusService);
  private readonly pos = inject(PosService);
  private readonly register = inject(CashRegisterService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly printer = inject(PrinterService);
  private readonly auth = inject(AuthService);
  private readonly device = inject(DeviceService).device;

  protected readonly sale = signal<FoundSale | null>(null);
  protected readonly mode = signal<'CASH' | 'CREDIT_NOTE'>('CASH');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected number = '';
  protected reason = '';

  protected readonly refund = computed(() => {
    const sale = this.sale();
    return sale ? sale.lines.reduce((sum, l) => sum + (l.toReturn ? returnAmount(l.lineTotal, l.quantity, l.toReturn,
      sale.total, sale.subtotal) : 0), 0) : 0;
  });

  protected async find(): Promise<void> {
    const number = this.number.trim();
    this.error.set(null);
    this.sale.set(null);
    if (!number) {
      return;
    }
    const local = (await this.local.db.local_sales.where('receipt_number').equals(number).first()) as LocalSale | undefined;
    if (this.offlineNetwork.online()) {
      try {
        const sale = await firstValueFrom(this.http.get<ServerSale>(`${this.api}/sales/sales/by-number/`,
          { params: { number } }));
        this.sale.set({ id: sale.id, number: sale.receipt_number, total: sale.total, subtotal: sale.subtotal, depot: null,
          lines: sale.lines.map((l) => ({ id: l.id, article: l.article, description: l.description, quantity: l.quantity,
            lineTotal: l.line_total, returnable: l.returnable, kitAdjustments: l.kit_adjustments, toReturn: 0 })) });
        return;
      } catch {
        if (!local) {
          this.error.set('Reçu introuvable.');
          return;
        }
      }
    }
    if (!local) {
      this.error.set('Reçu introuvable sur ce terminal (hors connexion, seules ses propres ventes sont disponibles).');
      return;
    }
    const returned = await this.local.db.local_returns.where('sale').equals(local.id).toArray();
    const payload = local.payload as { subtotal: number; depot: string; lines: { id: string; article: string;
      description: string; quantity: number; line_total: number; kit_adjustments?: unknown }[] };
    this.sale.set({ id: local.id, number: local.receipt_number, total: local.total, subtotal: payload.subtotal,
      depot: payload.depot, lines: payload.lines.map((l) => {
        const already = returned.flatMap((r) => r['lines'] as { sale_line: string; quantity: number }[])
          .filter((r) => r.sale_line === l.id).reduce((sum, r) => sum + r.quantity, 0);
        return { id: l.id, article: l.article, description: l.description, quantity: l.quantity, lineTotal: l.line_total,
          returnable: l.quantity - already, kitAdjustments: l.kit_adjustments, toReturn: 0 };
      }) });
  }

  protected setQty(index: number, value: string): void {
    this.sale.update((sale) => sale ? { ...sale, lines: sale.lines.map((l, i) => i === index
      ? { ...l, toReturn: Math.min(Math.max(0, Math.trunc(Number(value) || 0)), l.returnable) } : l) } : sale);
  }

  protected async submit(): Promise<void> {
    const sale = this.sale();
    const session = this.register.current();
    if (!sale) {
      return;
    }
    if (this.mode() === 'CASH' && !session) {
      this.snack.open('Un remboursement en espèces exige une caisse ouverte.', 'Fermer');
      return;
    }
    const manager = await firstValueFrom(this.dialog.open(ManagerAuthDialogComponent, { data: {
      title: 'Autorisation de retour', permission: 'sales.authorize',
      reason: `Retour de ${this.refund()} FCFA sur le reçu ${sale.number}.` }, width: '420px', maxWidth: '95vw',
    }).afterClosed()) as string | undefined;
    if (!manager) {
      return;
    }
    this.busy.set(true);
    const lines = sale.lines.filter((l) => l.toReturn > 0).map((l) => ({ sale_line: l.id, quantity: l.toReturn }));
    const id = crypto.randomUUID();
    const number = `${this.device()?.code ?? 'RET'}-R-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
    const payload = { id, number, sale: sale.id, lines, refund_mode: this.mode(), reason: this.reason.trim(),
      authorized_by: manager, cash_session: session?.id ?? null };
    const depot = sale.depot ?? session?.depot ?? this.device()?.depot ?? '';
    const deltas = depot ? (await Promise.all(sale.lines.filter((l) => l.toReturn).map((l) =>
      this.pos.lineDeltas({ id: l.id, article: { id: l.article, code: '', name: '', type: '', retail_price: 0,
        wholesale_price: null, wholesale_min_qty: null, avg_cost: 0 }, quantity: l.toReturn, customPrice: null,
        discount: 0, kitAdjustments: null, description: '' }, depot)))).flat().map((d) => ({ ...d, quantity: -d.quantity }))
      : [];
    await this.local.db.local_returns.add({ id, createdAt: Date.now(), sale: sale.id, cash_session: session?.id ?? null,
      refund_mode: this.mode(), total: this.refund(), lines });
    await this.outbox.enqueue('sale_return', 'create', payload, { stockDeltas: deltas,
      label: `Retour ${number} (${this.refund()} FCFA)` });
    await this.pos.afterWrite();
    await this.printer.print({
      title: 'Retour', number, date: new Date().toISOString(), cashier: this.auth.user()?.full_name ?? '',
      device: this.device()?.code ?? '', customer: null,
      lines: sale.lines.filter((l) => l.toReturn).map((l) => ({ name: l.description, quantity: l.toReturn,
        unitPrice: Math.round(l.lineTotal / l.quantity), discount: 0,
        total: returnAmount(l.lineTotal, l.quantity, l.toReturn, sale.total, sale.subtotal), details: [] })),
      subtotal: this.refund(), discountTotal: 0, total: this.refund(), payments: [], change: 0, loyaltyPoints: null,
      duplicate: false, qrValue: sale.number, library: await this.pos.library(),
      extra: [{ label: 'Reçu d’origine', value: sale.number },
        { label: this.mode() === 'CASH' ? 'Remboursé en espèces' : 'Avoir émis', value: `${this.refund()} FCFA` },
        { label: 'Autorisé par', value: manager }],
    });
    this.busy.set(false);
    this.snack.open('Retour enregistré.');
    this.sale.set(null);
    this.number = '';
    this.reason = '';
  }
}
