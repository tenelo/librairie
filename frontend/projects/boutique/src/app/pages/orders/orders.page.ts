import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FcfaPipe, OnlineOrder } from '@librairie/shared';

import { ShopApiService } from '../../services/shop-api.service';

/** Historique des commandes du client. */
@Component({
  selector: 'bt-orders-page',
  imports: [DatePipe, RouterLink, MatCardModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mes commandes</h1>
    <div class="list">
      @for (o of orders(); track o.id) {
        <a class="order" [routerLink]="['/mes-commandes', o.id]">
          <div>
            <strong>{{ o.number }}</strong>
            <span class="muted">du {{ o.created_at | date: 'dd/MM/yyyy à HH:mm' }} · {{ o.lines.length }} article(s)</span>
          </div>
          <span class="status" [class]="o.status">{{ o.status_label }}@if (o.awaiting_customer) { · votre accord est attendu }</span>
          <strong>{{ o.total | fcfa }}</strong>
          <mat-icon>chevron_right</mat-icon>
        </a>
      } @empty {
        @if (!loading()) { <p>Vous n'avez pas encore passé de commande. <a routerLink="/catalogue">Découvrir le catalogue</a></p> }
      }
    </div>
  `,
  styles: `
    .list { display: flex; flex-direction: column; gap: 8px; }
    .order { display: grid; grid-template-columns: 1fr auto auto auto; gap: 12px; align-items: center; padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px; color: inherit; text-decoration: none; }
    .order:hover { background: var(--mat-sys-surface-container); }
    .muted { display: block; font-size: 13px; opacity: 0.7; }
    .status { font-size: 13px; padding: 2px 10px; border-radius: 12px; background: var(--mat-sys-surface-container-high); }
    .READY { background: #e3f4e5; color: #1b5e20; }
    .CANCELLED, .EXPIRED { background: #fde8e8; color: #b00020; }
    @media (max-width: 599px) { .order { grid-template-columns: 1fr auto; } .order mat-icon { display: none; } }
  `,
})
export class OrdersPage implements OnInit {
  private readonly api = inject(ShopApiService);
  protected readonly orders = signal<OnlineOrder[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    this.api.orders().subscribe({
      next: (page) => {
        this.orders.set(page.results);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
