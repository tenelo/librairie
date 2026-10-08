import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, FcfaPipe, NetworkStatusService, OnlineOrder, apiErrorMessage } from '@librairie/shared';
import { interval } from 'rxjs';

import { OrderGroup, OrdersApiService } from './orders-api.service';

export const GROUP_BY_PATH: Record<string, { group: OrderGroup; title: string }> = {
  'a-confirmer': { group: 'to_confirm', title: 'Commandes à confirmer' },
  'a-preparer': { group: 'to_prepare', title: 'Commandes à préparer' },
  pretes: { group: 'ready', title: 'Commandes prêtes au retrait' },
  retirees: { group: 'picked_up', title: 'Commandes retirées' },
  annulees: { group: 'closed', title: 'Commandes annulées ou expirées' },
};

/** Files de commandes en ligne (une par étape), actualisées automatiquement. */
@Component({
  selector: 'bo-orders-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>{{ config.title }} ({{ orders().length }})</h1>
      <div class="toolbar">
        <input type="search" placeholder="N°, client, téléphone" aria-label="Rechercher une commande" [(ngModel)]="term" (keyup.enter)="load()" />
        <button mat-button type="button" (click)="load()"><mat-icon>refresh</mat-icon> Actualiser</button>
      </div>
    </header>
    @if (!network.online()) {
      <p class="offline-note">Hors ligne : les commandes déjà téléchargées restent préparables depuis leur écran de préparation.</p>
    }
    <table class="list">
      <thead><tr><th>Commande</th><th>Client</th><th>Retrait</th><th class="num">Articles</th><th class="num">Total</th><th>État</th><th></th></tr></thead>
      <tbody>
        @for (o of orders(); track o.id) {
          <tr class="clickable" (click)="open(o)">
            <td><strong>{{ o.number }}</strong><br /><small class="muted">{{ o.created_at | date: 'dd/MM HH:mm' }}</small></td>
            <td>{{ o.customer_name }}<br /><small class="muted">{{ o.customer_phone }}</small></td>
            <td>{{ o.pickup_depot_name }}@if (o.pickup_slot) { <br /><small>souhaité {{ o.pickup_slot | date: 'dd/MM HH:mm' }}</small> }
              @if (o.expires_at && o.status === 'READY') { <br /><small class="muted">expire {{ o.expires_at | date: 'dd/MM HH:mm' }}</small> }</td>
            <td class="num">{{ o.lines.length }}</td>
            <td class="num">{{ o.total | fcfa }}@if (o.deposit_paid) { <br /><small class="muted">acompte {{ o.deposit_paid | fcfa }}</small> }</td>
            <td>{{ o.status_label }}@if (o.awaiting_customer) { <br /><small class="error">attend l'accord du client</small> }
              @if (o.preparer_name) { <br /><small class="muted">{{ o.preparer_name }}</small> }</td>
            <td (click)="$event.stopPropagation()">
              @switch (o.status) {
                @case ('RECEIVED') { @if (canConfirm) { <button mat-flat-button type="button" (click)="confirm(o)">Confirmer</button> } }
                @case ('CONFIRMED') { @if (canPrepare) { <button mat-flat-button type="button" (click)="prepare(o)">Préparer</button> } }
                @case ('PREPARING') { @if (canPrepare && !o.awaiting_customer) { <button mat-stroked-button type="button" (click)="prepare(o)">Reprendre</button> } }
              }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="7" class="empty">Aucune commande.</td></tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: '../sales/sales-page.scss',
})
export class OnlineOrdersPage implements OnInit {
  private readonly api = inject(OrdersApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly config = GROUP_BY_PATH[inject(ActivatedRoute).snapshot.routeConfig?.path ?? 'a-confirmer']
    ?? GROUP_BY_PATH['a-confirmer'];
  protected readonly canConfirm = this.auth.hasPermission('orders.confirm');
  protected readonly canPrepare = this.auth.hasPermission('orders.prepare');
  protected readonly orders = signal<OnlineOrder[]>([]);
  protected term = '';

  ngOnInit(): void {
    this.load();
    interval(30000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.network.online() && !document.hidden) {
        this.load();
      }
    });
  }

  protected load(): void {
    this.api.list(this.config.group, this.term.trim()).subscribe({
      next: (page) => this.orders.set(page.results),
      error: () => undefined,
    });
  }

  protected open(order: OnlineOrder): void {
    void this.router.navigate(['/commandes/detail', order.id]);
  }

  protected confirm(order: OnlineOrder): void {
    this.api.confirm(order.id).subscribe({
      next: () => {
        this.snack.open(`Commande ${order.number} confirmée : stock réservé.`);
        this.load();
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 10000 }),
    });
  }

  protected prepare(order: OnlineOrder): void {
    void this.router.navigate(['/commandes/preparation', order.id]);
  }
}
