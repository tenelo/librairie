import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import {
  FcfaPipe,
  ORDER_STATUS_LABELS,
  ORDER_STEPS,
  OnlineOrder,
  OrderStatus,
  ShopReference,
  apiErrorMessage,
} from '@librairie/shared';
import { QRCodeComponent } from 'angularx-qrcode';
import { interval } from 'rxjs';

import { DepositStart, ShopApiService } from '../../services/shop-api.service';

/** Index de l'étape atteinte dans le suivi (−1 pour une commande annulée ou expirée). */
export function stepIndex(status: OrderStatus): number {
  return ORDER_STEPS.indexOf(status);
}

const LIVE_STATUSES: OrderStatus[] = ['RECEIVED', 'CONFIRMED', 'PREPARING', 'READY'];

/** Suivi d'une commande : étapes, code de retrait (QR + 6 chiffres), modification proposée, acompte. */
@Component({
  selector: 'bt-order-page',
  imports: [DatePipe, FormsModule, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, FcfaPipe, QRCodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a mat-button routerLink="/mes-commandes"><mat-icon>arrow_back</mat-icon> Mes commandes</a>
    @if (order(); as o) {
      <h1>Commande {{ o.number }}</h1>
      <p class="muted">Passée le {{ o.created_at | date: 'dd/MM/yyyy à HH:mm' }} · retrait à {{ o.pickup_depot_name }}
        @if (o.pickup_slot) { · créneau souhaité {{ o.pickup_slot | date: 'dd/MM HH:mm' }} }</p>

      @if (o.status === 'CANCELLED' || o.status === 'EXPIRED') {
        <p class="banner bad" role="status">{{ o.status_label }}@if (o.cancel_reason) { : {{ o.cancel_reason }} }</p>
      } @else {
        <ol class="steps" aria-label="Suivi de la commande">
          @for (s of steps; track s; let i = $index) {
            <li [class.done]="i <= current()" [class.current]="i === current()">{{ labels[s] }}</li>
          }
        </ol>
      }

      @if (o.awaiting_customer) {
        <mat-card appearance="outlined" class="proposal">
          <mat-card-content>
            <h2>Votre accord est nécessaire</h2>
            <p>Certains articles manquent. Voici ce que nous vous proposons :</p>
            <ul>
              @for (l of o.lines; track l.id) {
                @if (l.proposal.quantity !== undefined) {
                  <li>{{ l.description }} : {{ l.proposal.quantity }} au lieu de {{ l.quantity }}
                    @if (l.proposal.substitute_name) { , remplacé(s) par {{ l.proposal.substitute_quantity }} × {{ l.proposal.substitute_name }} ({{ l.proposal.unit_price! | fcfa }} l'unité) }</li>
                }
              }
            </ul>
          </mat-card-content>
          <mat-card-actions>
            <button mat-flat-button type="button" (click)="answer(true)" [disabled]="busy()">J'accepte</button>
            <button mat-button type="button" (click)="answer(false)" [disabled]="busy()">Je refuse (annuler la commande)</button>
          </mat-card-actions>
        </mat-card>
      }

      @if (o.status === 'READY') {
        <mat-card appearance="outlined" class="pickup">
          <mat-card-content>
            <h2>Votre commande est prête</h2>
            <qrcode [qrdata]="o.qr_payload" [width]="200" errorCorrectionLevel="M" [elementType]="'svg'" />
            <p class="code" aria-label="Code de retrait">{{ o.pickup_code }}</p>
            <p>Présentez ce QR code ou ce code à la caisse de {{ o.pickup_depot_name }}
              @if (o.expires_at) { avant le <strong>{{ o.expires_at | date: 'dd/MM/yyyy à HH:mm' }}</strong> }.</p>
            @if (o.balance_due) { <p>Reste à régler au retrait : <strong>{{ o.balance_due | fcfa }}</strong></p> }
          </mat-card-content>
        </mat-card>
      } @else if (o.status !== 'CANCELLED' && o.status !== 'EXPIRED' && o.status !== 'PICKED_UP') {
        <p>Code de retrait : <strong>{{ o.pickup_code }}</strong> (le QR code s'affichera quand la commande sera prête).</p>
      }
      @if (o.status === 'PICKED_UP') {
        <p class="banner good">Retirée le {{ o.picked_up_at | date: 'dd/MM/yyyy à HH:mm' }}@if (o.sale_receipt) { · reçu {{ o.sale_receipt }} }. Merci !</p>
      }

      <table class="lines">
        <thead><tr><th>Article</th><th class="num">Qté</th><th class="num">Prix</th><th class="num">Total</th></tr></thead>
        <tbody>
          @for (l of o.lines; track l.id) {
            <tr [class.struck]="l.quantity === 0">
              <td>{{ l.description }}@if (l.status !== 'OK') { <small class="muted"> ({{ l.status_label }}@if (l.ordered_qty !== l.quantity) {, commandé : {{ l.ordered_qty }}})</small> }</td>
              <td class="num">{{ l.quantity }}</td><td class="num">{{ l.unit_price | fcfa }}</td><td class="num">{{ l.line_total | fcfa }}</td>
            </tr>
          }
        </tbody>
        <tfoot>
          <tr><td colspan="3">Total</td><td class="num"><strong>{{ o.total | fcfa }}</strong></td></tr>
          @if (o.deposit_paid) { <tr><td colspan="3">Acompte payé</td><td class="num">− {{ o.deposit_paid | fcfa }}</td></tr> }
        </tfoot>
      </table>

      @if (o.payment_mode === 'DEPOSIT' && o.deposit_paid < o.deposit_due && live()) {
        <mat-card appearance="outlined" class="deposit">
          <mat-card-content>
            <h2>Payer l'acompte ({{ o.deposit_due - o.deposit_paid | fcfa }})</h2>
            @if (pending(); as p) {
              <p>{{ p.instructions }}</p>
              @if (p.sandbox) {
                <button mat-flat-button type="button" (click)="simulate(true)" [disabled]="busy()">Simuler un paiement réussi</button>
                <button mat-button type="button" (click)="simulate(false)" [disabled]="busy()">Simuler un échec</button>
              }
            } @else {
              <div class="row">
                <mat-form-field><mat-label>Opérateur</mat-label>
                  <mat-select [(ngModel)]="operator">
                    @for (op of reference()?.operators ?? []; track op.code) { <mat-option [value]="op.code">{{ op.label }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field><mat-label>Numéro Mobile Money</mat-label><input matInput inputmode="tel" [(ngModel)]="phone" /></mat-form-field>
                <button mat-flat-button type="button" (click)="startDeposit()" [disabled]="busy() || !operator || !phone">Payer</button>
              </div>
            }
          </mat-card-content>
        </mat-card>
      }

      @if (o.status === 'RECEIVED' || o.status === 'CONFIRMED') {
        <button mat-stroked-button type="button" class="cancel" (click)="cancel()" [disabled]="busy()">Annuler ma commande</button>
      }

      <h2>Historique</h2>
      <ul class="history">
        @for (h of o.history; track $index) { <li>{{ h.at | date: 'dd/MM HH:mm' }} · {{ h.to_label }}@if (h.note) { — {{ h.note }} }</li> }
      </ul>
    } @else {
      <p>Chargement…</p>
    }
  `,
  styles: `
    .muted { opacity: 0.7; }
    .steps { display: flex; list-style: none; padding: 0; gap: 4px; flex-wrap: wrap; counter-reset: step; }
    .steps li { flex: 1 1 100px; padding: 8px; text-align: center; border-bottom: 4px solid var(--mat-sys-outline-variant); font-size: 13px; }
    .steps li.done { border-color: var(--mat-sys-primary); }
    .steps li.current { font-weight: 600; }
    .banner { padding: 12px; border-radius: 8px; }
    .bad { background: #fde8e8; color: #b00020; }
    .good { background: #e3f4e5; color: #1b5e20; }
    .pickup mat-card-content { text-align: center; }
    .code { font-size: 32px; letter-spacing: 8px; font-weight: 700; margin: 0; }
    .proposal { border-color: #b45309; margin: 12px 0; }
    .lines { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .lines td, .lines th { padding: 6px; border-bottom: 1px solid var(--mat-sys-outline-variant); text-align: left; }
    .num { text-align: right !important; }
    .struck td { text-decoration: line-through; opacity: 0.6; }
    .deposit .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .cancel { margin: 8px 0 16px; }
    .history { font-size: 13px; }
  `,
})
export class OrderPage implements OnInit {
  readonly id = input.required<string>();
  private readonly api = inject(ShopApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly steps = ORDER_STEPS;
  protected readonly labels = ORDER_STATUS_LABELS;
  protected readonly order = signal<OnlineOrder | null>(null);
  protected readonly reference = signal<ShopReference | null>(null);
  protected readonly pending = signal<DepositStart | null>(null);
  protected readonly busy = signal(false);
  protected readonly current = computed(() => stepIndex(this.order()?.status ?? 'RECEIVED'));
  protected readonly live = computed(() => LIVE_STATUSES.includes(this.order()?.status ?? 'CANCELLED'));
  protected operator = '';
  protected phone = '';

  ngOnInit(): void {
    this.load();
    this.api.reference().subscribe({ next: (ref) => this.reference.set(ref), error: () => undefined });
    // Suivi en temps réel : actualisation régulière tant que la commande est en cours.
    interval(20000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.live() && !document.hidden) {
        this.load();
      }
    });
  }

  protected load(): void {
    this.api.order(this.id()).subscribe({ next: (order) => this.order.set(order), error: () => undefined });
  }

  private run(request: ReturnType<ShopApiService['cancel']>, message: string): void {
    this.busy.set(true);
    request.subscribe({
      next: (order) => {
        this.busy.set(false);
        this.order.set(order);
        this.snack.open(message);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
      },
    });
  }

  protected cancel(): void {
    if (confirm('Annuler cette commande ?')) {
      this.run(this.api.cancel(this.id()), 'Commande annulée.');
    }
  }

  protected answer(accept: boolean): void {
    this.run(this.api.answer(this.id(), accept), accept ? 'Merci, nous finalisons votre commande.' : 'Commande annulée.');
  }

  protected startDeposit(): void {
    this.busy.set(true);
    this.api.deposit(this.id(), this.phone.trim(), this.operator).subscribe({
      next: (start) => {
        this.busy.set(false);
        this.pending.set(start);
        if (start.redirect_url) {
          window.location.href = start.redirect_url;
        }
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
      },
    });
  }

  protected simulate(success: boolean): void {
    const pending = this.pending();
    if (!pending) {
      return;
    }
    this.busy.set(true);
    this.api.simulatePayment(pending.reference, success).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.pending.set(null);
        this.snack.open(result.status === 'SUCCEEDED' ? 'Acompte reçu, merci !' : 'Paiement refusé.');
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer');
      },
    });
  }
}
