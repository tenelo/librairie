import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { CartPayment, FcfaPipe, SyncedRow, checkPayments } from '@librairie/shared';

export interface PaymentDialogData {
  total: number;
  methods: SyncedRow[];
  hasCustomer: boolean;
  customerCredit: { balance: number; limit: number } | null;
}

/** Encaissement : paiements multiples (espèces avec monnaie, Mobile Money, carte, crédit, bon, avoir). */
@Component({
  selector: 'bo-payment-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Encaisser {{ data.total | fcfa }}</h2>
    <mat-dialog-content>
      <div class="methods">
        @for (m of data.methods; track m.id) {
          <button mat-stroked-button type="button" (click)="add(m)">{{ m['label'] }}</button>
        }
      </div>
      <table class="payments">
        @for (p of payments(); track $index; let i = $index) {
          <tr>
            <td><strong>{{ label(p.method) }}</strong></td>
            <td><input type="number" min="0" [value]="p.amount" (input)="patch(i, { amount: +$any($event.target).value })"
                       [attr.aria-label]="'Montant ' + label(p.method)" /></td>
            <td>
              @if (p.kind === 'MOBILE_MONEY' || p.kind === 'CARD') {
                <input placeholder="Référence de transaction" [value]="p.reference ?? ''"
                       (input)="patch(i, { reference: $any($event.target).value })" aria-label="Référence" />
              }
              @if (p.kind === 'VOUCHER') {
                <input placeholder="Code du bon" [value]="p.voucher_code ?? ''"
                       (input)="patch(i, { voucher_code: $any($event.target).value })" aria-label="Code du bon" />
              }
              @if (p.kind === 'CREDIT_NOTE') {
                <input placeholder="N° d'avoir" [value]="p.credit_note_number ?? ''"
                       (input)="patch(i, { credit_note_number: $any($event.target).value })" aria-label="Numéro d'avoir" />
              }
              @if (p.kind === 'CASH') {
                <span class="quick">
                  @for (v of quickCash(); track v) {
                    <button mat-button type="button" (click)="patch(i, { amount: v })">{{ v | fcfa }}</button>
                  }
                </span>
              }
            </td>
            <td><button mat-icon-button type="button" (click)="remove(i)" aria-label="Retirer"><mat-icon>close</mat-icon></button></td>
          </tr>
        }
      </table>
      <div class="summary">
        <div><span>Total</span><strong>{{ data.total | fcfa }}</strong></div>
        <div><span>Payé</span><strong>{{ check().paid | fcfa }}</strong></div>
        @if (check().remaining) { <div class="due"><span>Reste à payer</span><strong>{{ check().remaining | fcfa }}</strong></div> }
        @if (check().change) { <div class="change"><span>Monnaie à rendre</span><strong>{{ check().change | fcfa }}</strong></div> }
        @if (data.customerCredit; as c) {
          <div class="muted"><span>Crédit client (encours / plafond)</span><span>{{ c.balance | fcfa }} / {{ c.limit | fcfa }}</span></div>
        }
      </div>
      @if (payments().length && check().error) { <p class="error" role="alert">{{ check().error }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Annuler</button>
      <button mat-flat-button type="button" (click)="confirm()" [disabled]="!check().valid || !payments().length">
        <mat-icon>check</mat-icon> Valider la vente (F9)
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .methods { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .payments { width: 100%; border-collapse: collapse; }
    .payments td { padding: 4px; vertical-align: middle; }
    input { font: inherit; padding: 6px; width: 140px; border: 1px solid var(--mat-sys-outline); border-radius: 4px;
      background: transparent; color: inherit; }
    .quick { display: inline-flex; flex-wrap: wrap; }
    .summary { margin-top: 12px; display: grid; gap: 4px; }
    .summary div { display: flex; justify-content: space-between; }
    .due { color: var(--mat-sys-error); }
    .change strong { font-size: 22px; color: #2e7d32; }
    .error { color: var(--mat-sys-error); }
    .muted { opacity: 0.75; }
  `,
  host: { '(document:keydown.f9)': 'onF9($event)' },
})
export class PaymentDialogComponent {
  protected readonly data = inject<PaymentDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<PaymentDialogComponent, CartPayment[]>);
  protected readonly payments = signal<CartPayment[]>([]);
  private readonly byCode = new Map(this.data.methods.map((m) => [String(m['code']), m]));

  protected readonly check = computed(() => checkPayments(this.data.total, this.payments(),
    (code) => Boolean(this.byCode.get(code)?.['requires_reference']), this.data.hasCustomer));

  /** Montants d'espèces proposés : le reste exact, puis les billets ronds supérieurs. */
  protected readonly quickCash = computed(() => {
    const due = Math.max(this.data.total - this.payments().filter((p) => p.kind !== 'CASH')
      .reduce((sum, p) => sum + p.amount, 0), 0);
    const options = new Set([due]);
    for (const note of [1000, 2000, 5000, 10000]) {
      options.add(Math.ceil(due / note) * note);
    }
    return [...options].filter((v) => v > 0).sort((a, b) => a - b).slice(0, 4);
  });

  constructor() {
    const cash = this.data.methods.find((m) => m['code'] === 'CASH');
    if (cash) {
      this.add(cash);
    }
  }

  protected label(code: string): string {
    return String(this.byCode.get(code)?.['label'] ?? code);
  }

  protected add(method: SyncedRow): void {
    const remaining = this.check().remaining || (this.payments().length ? 0 : this.data.total);
    this.payments.update((list) => [...list, { method: String(method['code']), kind: String(method['kind']),
      amount: remaining }]);
  }

  protected patch(index: number, changes: Partial<CartPayment>): void {
    this.payments.update((list) => list.map((p, i) => (i === index ? { ...p, ...changes } : p)));
  }

  protected remove(index: number): void {
    this.payments.update((list) => list.filter((_, i) => i !== index));
  }

  protected onF9(event: Event): void {
    event.preventDefault();
    this.confirm();
  }

  protected confirm(): void {
    if (this.check().valid && this.payments().length) {
      this.ref.close(this.payments());
    }
  }
}
