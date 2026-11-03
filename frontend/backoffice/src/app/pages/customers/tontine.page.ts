import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AuthService, FcfaPipe, LocalDbService, PrinterService, ReceiptData, SyncedRow, apiErrorMessage } from '@librairie/shared';

import { TONTINE_LABEL } from '../../features';
import { LibraryScopeService } from '../../services/library-scope.service';
import { CashRegisterService } from '../sales/cash-register.service';
import { PosService } from '../sales/pos.service';

import { Tontine, TontineEvent, TontinePayment, TontinesApiService } from './tontines-api.service';

/** Moyens acceptés pour un versement (ceux qui apportent de l'argent). */
const PAYABLE_KINDS = ['CASH', 'MOBILE_MONEY', 'CARD'];

/** Fiche d'une souscription : souscripteur, souscription, versements (avec reçu) et remise à la caisse. */
@Component({
  selector: 'bo-tontine-page',
  imports: [DatePipe, FormsModule, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule,
    FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a mat-button routerLink="/tontine-scolaire/souscriptions"><mat-icon>arrow_back</mat-icon> {{ label }}</a>
    @if (tontine(); as t) {
      <div class="page-header">
        @if (editing()) {
          <div class="form-row">
            <input type="text" [(ngModel)]="editName" maxlength="150" aria-label="Nom et prénoms du souscripteur" />
            <input type="tel" [(ngModel)]="editPhone" maxlength="20" aria-label="Numéro de téléphone" />
            <button mat-flat-button type="button" (click)="saveSubscriber()" [disabled]="busy() || editName.trim().length < 2">Enregistrer</button>
            <button mat-button type="button" (click)="editing.set(false)">Annuler</button>
          </div>
        } @else {
          <h1>{{ t.subscriber_name }} <small class="muted">{{ t.subscriber_phone }}</small>
            @if (canManage && own() && t.status === 'OPEN') {
              <button mat-icon-button type="button" (click)="startEdit()" matTooltip="Modifier le nom ou le numéro"
                      aria-label="Modifier le nom ou le numéro"><mat-icon>edit</mat-icon></button>
            }
          </h1>
        }
        <span class="badge" [class.settled]="settled()" [class.done]="t.status === 'DELIVERED'">
          {{ settled() ? 'Soldée — à retirer' : t.status_label }}
        </span>
      </div>
      <p class="muted">{{ t.number }} · année scolaire {{ t.school_year_label ?? '—' }} · souscrite le {{ t.created_at | date: 'dd/MM/yyyy' }}
        par {{ t.created_by_name }}
        @if (t.sale_receipt) { · remise le {{ t.delivered_at | date: 'dd/MM/yyyy' }} par {{ t.delivered_by_name ?? '—' }} (reçu {{ t.sale_receipt }}) }
        @if (t.status === 'CANCELLED') { · annulée le {{ t.cancelled_at | date: 'dd/MM/yyyy' }} par {{ t.cancelled_by_name ?? '—' }}
          @if (t.cancel_reason) { ({{ t.cancel_reason }}) } }</p>

      <div class="kpis">
        <div><span>Montant de la souscription</span><strong>{{ t.target_amount | fcfa }}</strong></div>
        <div><span>Déjà versé</span><strong>{{ t.paid_amount | fcfa }}</strong></div>
        <div><span>Reste à verser</span><strong>{{ t.remaining | fcfa }}</strong></div>
        <div><span>Où il en est</span><strong>{{ t.progress }} %</strong></div>
      </div>
      <mat-progress-bar mode="determinate" [value]="t.progress" aria-label="Progression des versements" />

      <div class="card">
        <h2>Souscription</h2>
        <table class="list">
          <thead><tr><th class="num">Qté</th><th>Article</th><th class="num">Prix</th><th class="num">Montant</th></tr></thead>
          <tbody>
            @for (l of t.lines; track l.id) {
              <tr><td class="num">{{ l.quantity }}</td><td>{{ l.description }}</td>
                <td class="num">{{ l.unit_price | fcfa }}</td><td class="num">{{ l.line_total | fcfa }}</td></tr>
            }
          </tbody>
        </table>
      </div>

      @if (!own()) {
        <p class="muted"><mat-icon inline>visibility</mat-icon> Souscription de {{ t.library_name }} : consultation seulement.</p>
      }
      @if (t.status === 'OPEN' && canManage && own() && t.remaining > 0) {
        <div class="card">
          <h2>Nouveau versement</h2>
          <div class="form-row">
            <input type="number" min="1" [max]="t.remaining" [(ngModel)]="amount" placeholder="Montant" aria-label="Montant du versement" />
            @for (v of quickAmounts(); track v) {
              <button mat-stroked-button type="button" (click)="amount = v">{{ v | fcfa }}</button>
            }
          </div>
          <div class="form-row">
            <select [(ngModel)]="method" aria-label="Moyen de paiement">
              @for (m of methods(); track m.id) { <option [value]="m['code']">{{ m['label'] }}</option> }
            </select>
            @if (needsReference()) {
              <input type="text" [(ngModel)]="reference" placeholder="Référence de transaction" aria-label="Référence de transaction" />
            }
            <button mat-flat-button type="button" (click)="pay()" [disabled]="busy() || !amount || amount > t.remaining">
              <mat-icon>payments</mat-icon> Encaisser et imprimer le reçu
            </button>
          </div>
          @if (method === 'CASH' && !register.current()) {
            <p class="error">Ouvrez la caisse de ce poste pour encaisser en espèces.</p>
          }
        </div>
      }

      <div class="card">
        <h2>Versements</h2>
        <table class="list">
          <thead><tr><th>Date</th><th>Moyen</th><th class="num">Montant</th><th>Reçu</th><th></th></tr></thead>
          <tbody>
            @for (p of t.payments; track p.id) {
              <tr [class.refund]="p.kind === 'REFUND'">
                <td>{{ p.paid_at | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ p.method_label }}@if (p.reference) { <small class="muted"> · {{ p.reference }}</small> }
                  @if (p.kind === 'REFUND') { <small> (remboursement)</small> }</td>
                <td class="num">{{ p.amount | fcfa }}</td>
                <td><code>{{ p.number }}</code></td>
                <td><button mat-icon-button type="button" (click)="print(p, true)" aria-label="Réimprimer le reçu"><mat-icon>print</mat-icon></button></td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="empty">Aucun versement pour l'instant.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Historique</h2>
        <table class="list">
          <thead><tr><th>Date</th><th>Action</th><th>Détail</th><th>Par</th></tr></thead>
          <tbody>
            @for (e of history(); track $index) {
              <tr><td>{{ e.date | date: 'dd/MM/yyyy HH:mm' }}</td><td>{{ e.action }}</td><td>{{ e.description }}</td>
                <td>{{ e.user || '—' }}</td></tr>
            } @empty {
              <tr><td colspan="4" class="empty">Aucun événement enregistré.</td></tr>
            }
          </tbody>
        </table>
      </div>

      @if (t.status === 'OPEN' && own()) {
        <div class="actions">
          @if (canDeliver) {
            <button mat-flat-button type="button" (click)="deliver()">
              <mat-icon>inventory_2</mat-icon> Remettre les fournitures (caisse)
            </button>
          }
          @if (canCancel) {
            <button mat-button type="button" class="danger" (click)="cancel()" [disabled]="busy()">
              <mat-icon>cancel</mat-icon> Annuler et rembourser {{ t.available | fcfa }}
            </button>
          }
        </div>
      }
    }
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    h1 small { font-size: 16px; font-weight: normal; }
    .badge { padding: 4px 10px; border-radius: 12px; background: var(--mat-sys-surface-container-high); }
    .badge.settled { background: #2e7d32; color: #fff; }
    .badge.done { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    mat-progress-bar { margin-bottom: 16px; }
    .form-row { margin-bottom: 8px; }
    .form-row input, .form-row select { font: inherit; padding: 8px; border: 1px solid var(--mat-sys-outline);
      border-radius: 8px; background: transparent; color: inherit; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .danger { color: var(--mat-sys-error); }
    .refund td { color: var(--mat-sys-error); }
  `,
})
export class TontinePage {
  readonly id = input.required<string>();

  private readonly api = inject(TontinesApiService);
  private readonly local = inject(LocalDbService);
  private readonly printer = inject(PrinterService);
  private readonly pos = inject(PosService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);
  protected readonly register = inject(CashRegisterService);
  protected readonly label = TONTINE_LABEL;
  private readonly scope = inject(LibraryScopeService);
  /** Souscription d'une autre librairie : consultation seulement. */
  protected readonly own = computed(() => this.scope.seesAll() || this.tontine()?.library === this.scope.myLibrary()?.id);
  protected readonly canManage = this.auth.hasPermission('tontines.manage');
  protected readonly canCancel = this.auth.hasPermission('tontines.cancel');
  protected readonly canDeliver = this.auth.hasPermission('sales.create');

  protected readonly tontine = signal<Tontine | null>(null);
  /** Traçabilité : qui a fait quoi et quand sur cette souscription. */
  protected readonly history = signal<TontineEvent[]>([]);
  protected readonly methods = signal<SyncedRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly editing = signal(false);
  protected readonly settled = computed(() => this.tontine()?.status === 'OPEN' && this.tontine()?.remaining === 0);
  protected amount: number | null = null;
  protected method = 'CASH';
  protected reference = '';
  protected editName = '';
  protected editPhone = '';

  /** Montants proposés : quelques versements ronds et le solde exact. */
  protected readonly quickAmounts = computed(() => {
    const remaining = this.tontine()?.remaining ?? 0;
    return [...new Set([1000, 2500, 5000, remaining])].filter((v) => v > 0 && v <= remaining).sort((a, b) => a - b);
  });

  constructor() {
    void this.loadMethods();
    effect(() => this.load(this.id()));
  }

  private load(id: string): void {
    this.api.get(id).subscribe({
      next: (tontine) => this.tontine.set(tontine),
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 }),
    });
    this.api.history(id).subscribe({ next: (events) => this.history.set(events), error: () => this.history.set([]) });
  }

  private async loadMethods(): Promise<void> {
    const rows = (await this.local.db.payment_methods.toArray())
      .filter((m) => m['is_active'] && !m['is_deleted'] && PAYABLE_KINDS.includes(String(m['kind'])))
      .sort((a, b) => Number(a['sort_order']) - Number(b['sort_order']));
    this.methods.set(rows);
    if (rows.length && !rows.some((m) => m['code'] === this.method)) {
      this.method = String(rows[0]['code']);
    }
  }

  protected needsReference(): boolean {
    const method = this.methods().find((m) => m['code'] === this.method);
    return !!method && method['kind'] !== 'CASH';
  }

  protected startEdit(): void {
    this.editName = this.tontine()?.subscriber_name ?? '';
    this.editPhone = this.tontine()?.subscriber_phone ?? '';
    this.editing.set(true);
  }

  protected saveSubscriber(): void {
    const tontine = this.tontine();
    if (!tontine) {
      return;
    }
    this.busy.set(true);
    this.api.update(tontine.id, { subscriber_name: this.editName.trim(), subscriber_phone: this.editPhone.trim() })
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.editing.set(false);
          this.tontine.set(updated);
          this.load(updated.id);
          this.snack.open('Souscripteur modifié.', 'OK', { duration: 4000 });
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
        },
      });
  }

  protected pay(): void {
    const tontine = this.tontine();
    const amount = Math.round(Number(this.amount));
    if (!tontine || !amount) {
      return;
    }
    this.busy.set(true);
    this.api.pay(tontine.id, { amount, method: this.method, reference: this.reference.trim(),
      cash_session: this.register.current()?.id ?? null }).subscribe({
      next: (payment) => {
        this.busy.set(false);
        this.amount = null;
        this.reference = '';
        this.snack.open(`Versement de ${payment.amount} FCFA enregistré.`, 'OK', { duration: 5000 });
        if (payment.method_code === 'CASH') {
          void this.register.recordTontineCash(payment.amount, payment.number);
        }
        // Reçu imprimé avec la situation à jour, puis retour à la liste.
        this.api.get(tontine.id).subscribe(async (updated) => {
          this.tontine.set(updated);
          await this.print(payment, false);
          this.backToList();
        });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
      },
    });
  }

  /** Reçu du versement, avec où en est le souscripteur (versé, reste). */
  protected async print(payment: TontinePayment, duplicate: boolean): Promise<void> {
    const t = this.tontine();
    if (!t) {
      return;
    }
    const receipt: ReceiptData = {
      title: `${payment.kind === 'REFUND' ? 'Remboursement' : 'Versement'} — ${TONTINE_LABEL}`,
      number: payment.number, date: payment.paid_at, cashier: payment.user_name, device: '',
      customer: `${t.subscriber_name}${t.subscriber_phone ? ` (${t.subscriber_phone})` : ''}`, lines: [],
      subtotal: payment.amount, discountTotal: 0, total: payment.amount,
      payments: [{ label: payment.method_label, amount: Math.abs(payment.amount), reference: payment.reference || undefined }],
      change: 0, loyaltyPoints: null, duplicate,
      extra: [
        { label: 'Souscription', value: t.number },
        { label: 'Montant de la souscription', value: `${t.target_amount} FCFA` },
        { label: 'Total versé', value: `${t.paid_amount} FCFA` },
        { label: 'Reste à verser', value: `${t.remaining} FCFA` },
      ],
      qrValue: t.number, library: await this.pos.library(),
    };
    await this.printer.print(receipt);
  }

  private backToList(): void {
    void this.router.navigate(['/tontine-scolaire/souscriptions']);
  }

  protected deliver(): void {
    void this.router.navigate(['/caisse/nouvelle-vente'], { queryParams: { tontine: this.tontine()?.id } });
  }

  protected cancel(): void {
    const tontine = this.tontine();
    if (!tontine) {
      return;
    }
    const reason = prompt(`Motif de l'annulation de la souscription de ${tontine.subscriber_name} ?`
      + (tontine.available ? ` ${tontine.available} FCFA lui seront rendus en espèces.` : ''));
    if (!reason?.trim()) {
      return;
    }
    if (tontine.available && !this.register.current()) {
      this.snack.open('Ouvrez la caisse de ce poste pour rembourser en espèces.', 'Fermer', { duration: 6000 });
      return;
    }
    this.busy.set(true);
    this.api.cancel(tontine.id, { reason: reason.trim(), method: 'CASH', cash_session: this.register.current()?.id ?? null })
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.tontine.set(updated);
          this.snack.open('Souscription annulée.', 'OK', { duration: 5000 });
          const refund = updated.payments.find((p) => p.kind === 'REFUND');
          if (refund?.method_code === 'CASH') {
            void this.register.recordTontineCash(refund.amount, refund.number);
          }
          void (refund ? this.print(refund, false) : Promise.resolve()).then(() => this.backToList());
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
        },
      });
  }
}
