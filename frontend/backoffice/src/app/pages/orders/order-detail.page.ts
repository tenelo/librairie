import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { AuthService, FcfaPipe, OnlineOrder, apiErrorMessage } from '@librairie/shared';
import { QRCodeComponent } from 'angularx-qrcode';
import { Observable } from 'rxjs';

import { OrdersApiService, PickingLine } from './orders-api.service';

/** Fiche d'une commande en ligne : actions, liste de préparation et étiquette de colis imprimables. */
@Component({
  selector: 'bo-order-detail-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, FcfaPipe, QRCodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (order(); as o) {
      <div class="no-print">
        <header class="page-header">
          <h1>Commande {{ o.number }} · {{ o.status_label }}</h1>
          <a mat-button routerLink="/commandes"><mat-icon>arrow_back</mat-icon> Commandes</a>
        </header>
        <p>{{ o.customer_name }} · {{ o.customer_phone }} · retrait à {{ o.pickup_depot_name }}
          @if (o.pickup_slot) { · créneau souhaité {{ o.pickup_slot | date: 'dd/MM/yyyy HH:mm' }} }</p>
        @if (o.comment) { <p class="card">Commentaire du client : {{ o.comment }}</p> }
        @if (o.awaiting_customer) { <p class="offline-note">Une modification a été proposée au client : en attente de sa réponse.</p> }
        <div class="kpis">
          <div><span>Total</span><strong>{{ o.total | fcfa }}</strong></div>
          <div><span>Paiement</span><strong>{{ o.payment_mode_label }}</strong></div>
          <div><span>Acompte payé</span><strong>{{ o.deposit_paid | fcfa }}</strong></div>
          <div><span>Reste dû</span><strong>{{ o.balance_due | fcfa }}</strong></div>
          @if (o.status === 'READY') { <div><span>Code de retrait</span><strong>{{ o.pickup_code }}</strong></div> }
        </div>
        <div class="toolbar">
          @if (o.status === 'RECEIVED' && canConfirm) {
            <button mat-flat-button type="button" (click)="run(api.confirm(o.id), 'Commande confirmée, stock réservé.')"><mat-icon>check</mat-icon> Confirmer</button>
          }
          @if ((o.status === 'CONFIRMED' || o.status === 'PREPARING') && canPrepare && !o.awaiting_customer) {
            <a mat-flat-button [routerLink]="['/commandes/preparation', o.id]"><mat-icon>qr_code_scanner</mat-icon> Préparer par scan</a>
          }
          @if (o.status !== 'PICKED_UP' && o.status !== 'CANCELLED' && o.status !== 'EXPIRED') {
            <button mat-button type="button" (click)="printDoc('picking')"><mat-icon>list_alt</mat-icon> Liste de préparation</button>
          }
          @if (o.status === 'READY' || o.status === 'PREPARING') {
            <button mat-button type="button" (click)="printDoc('label')"><mat-icon>label</mat-icon> Étiquette du colis</button>
          }
          @if (o.status === 'READY' && canPickup) {
            <a mat-stroked-button routerLink="/caisse/nouvelle-vente" [queryParams]="{ commande: o.id }"><mat-icon>point_of_sale</mat-icon> Retrait en caisse</a>
          }
          @if (canConfirm && ['RECEIVED', 'CONFIRMED', 'PREPARING', 'READY'].includes(o.status)) {
            <button mat-button type="button" (click)="cancel()"><mat-icon>cancel</mat-icon> Annuler</button>
          }
        </div>
        <table class="list">
          <thead><tr><th>Article</th><th class="num">Commandé</th><th class="num">Retenu</th><th class="num">Préparé</th><th class="num">Prix</th><th class="num">Total</th></tr></thead>
          <tbody>
            @for (l of o.lines; track l.id) {
              <tr>
                <td>{{ l.description }} <small class="muted">{{ l.code }}</small>
                  @if (l.status !== 'OK') { <br /><small>{{ l.status_label }}</small> }
                  @if (l.proposal.quantity !== undefined) { <br /><small class="error">Proposé : {{ l.proposal.quantity }}@if (l.proposal.substitute_name) { + {{ l.proposal.substitute_quantity }} × {{ l.proposal.substitute_name }} }</small> }</td>
                <td class="num">{{ l.ordered_qty }}</td><td class="num">{{ l.quantity }}</td><td class="num">{{ l.prepared_qty }}</td>
                <td class="num">{{ l.unit_price | fcfa }}</td><td class="num">{{ l.line_total | fcfa }}</td>
              </tr>
            }
          </tbody>
        </table>
        @if (o.payments.length) {
          <h2>Paiements en ligne</h2>
          <ul>@for (p of o.payments; track p.id) { <li>{{ p.created_at | date: 'dd/MM HH:mm' }} · {{ p.amount | fcfa }} · {{ p.operator }} {{ p.phone }} · {{ p.status_label }} ({{ p.external_ref }})</li> }</ul>
        }
        <h2>Historique</h2>
        <ul>
          @for (h of o.history; track $index) {
            <li>{{ h.at | date: 'dd/MM/yyyy HH:mm' }} · {{ h.to_label }}@if (h.user_name) { · {{ h.user_name }} }@if (h.note) { — {{ h.note }} }</li>
          }
        </ul>
        @if (o.sale_receipt) { <p>Vente associée : <strong>{{ o.sale_receipt }}</strong></p> }
      </div>

      @if (printing() === 'picking') {
        <section class="print-only">
          <h1>Liste de préparation · {{ o.number }}</h1>
          <p>{{ o.customer_name }} · {{ o.customer_phone }} · {{ o.pickup_depot_name }} · imprimée le {{ now | date: 'dd/MM/yyyy HH:mm' }}</p>
          <table class="picking">
            <thead><tr><th>Empl.</th><th>Code</th><th>Article</th><th class="num">Qté</th><th>✓</th></tr></thead>
            <tbody>
              @for (p of picking(); track p.line) {
                <tr><td>{{ p.location || '—' }}</td><td>{{ p.code }}</td><td>{{ p.name }}
                  @for (c of p.components; track $index) { <br /><small>· {{ c.quantity }} × {{ c.name }} ({{ c.code }})</small> }</td>
                  <td class="num"><strong>{{ p.quantity }}</strong></td><td class="box"></td></tr>
              }
            </tbody>
          </table>
          @if (o.comment) { <p>Commentaire : {{ o.comment }}</p> }
        </section>
      }
      @if (printing() === 'label') {
        <section class="print-only labels">
          @for (n of parcels(); track n) {
            <div class="parcel">
              <qrcode [qrdata]="o.qr_payload" [width]="120" [margin]="0" errorCorrectionLevel="M" elementType="svg" />
              <div>
                <p class="big">{{ o.number }}</p>
                <p><strong>{{ o.customer_name }}</strong><br />{{ o.customer_phone }}</p>
                <p>Retrait : {{ o.pickup_depot_name }}<br />Colis {{ n }} / {{ parcels().length }}</p>
              </div>
            </div>
          }
        </section>
      }
    } @else {
      <p>Chargement…</p>
    }
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .print-only { display: none; }
    .picking { width: 100%; border-collapse: collapse; }
    .picking td, .picking th { border: 1px solid #999; padding: 4px 6px; text-align: left; }
    .picking .box { width: 28px; }
    .parcel { display: flex; gap: 12px; align-items: center; border: 1px dashed #666; padding: 8mm; margin-bottom: 6mm;
      page-break-inside: avoid; }
    .big { font-size: 22pt; font-weight: 700; margin: 0; }
    @media print {
      .no-print { display: none !important; }
      .print-only { display: block; color: #000; }
    }
  `,
})
export class OrderDetailPage implements OnInit {
  readonly id = input.required<string>();
  protected readonly api = inject(OrdersApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  protected readonly canConfirm = this.auth.hasPermission('orders.confirm');
  protected readonly canPrepare = this.auth.hasPermission('orders.prepare');
  protected readonly canPickup = this.auth.hasPermission('orders.pickup');
  protected readonly order = signal<OnlineOrder | null>(null);
  protected readonly picking = signal<PickingLine[]>([]);
  protected readonly printing = signal<'picking' | 'label' | null>(null);
  protected readonly parcels = signal<number[]>([1]);
  protected readonly now = new Date();

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.api.get(this.id()).subscribe({
      next: (order) => {
        this.order.set(order);
        this.parcels.set(Array.from({ length: Math.max(order.parcels ?? 1, 1) }, (_, i) => i + 1));
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
    });
  }

  protected run(request: Observable<OnlineOrder>, message: string): void {
    request.subscribe({
      next: (order) => {
        this.order.set(order);
        this.snack.open(message);
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 10000 }),
    });
  }

  protected cancel(): void {
    const reason = prompt('Motif de l\'annulation (communiqué au client) :');
    if (reason?.trim()) {
      this.run(this.api.cancel(this.id(), reason.trim()), 'Commande annulée, stock libéré.');
    }
  }

  protected printDoc(kind: 'picking' | 'label'): void {
    const go = () => {
      this.printing.set(kind);
      setTimeout(() => {
        window.print();
        this.printing.set(null);
      }, 200);
    };
    if (kind === 'picking') {
      this.api.picking(this.id()).subscribe({
        next: (data) => {
          this.picking.set(data.lines);
          go();
        },
        error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
      });
    } else {
      go();
    }
  }
}
