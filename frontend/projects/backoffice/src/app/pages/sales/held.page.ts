import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { HeldSale, LocalDbService } from '@librairie/shared';

/** Ventes mises en attente sur ce terminal (conservées localement, reprises dans l'écran de caisse). */
@Component({
  selector: 'bo-held-page',
  imports: [DatePipe, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Ventes en attente</h1>
    <table class="list">
      <thead><tr><th>Depuis</th><th>Vente</th><th>Caissier</th><th></th></tr></thead>
      <tbody>
        @for (h of held(); track h.id) {
          <tr>
            <td>{{ h.createdAt | date: 'dd/MM HH:mm' }}</td>
            <td>{{ h.label }}</td>
            <td>{{ h.cashier }}</td>
            <td class="num">
              <button mat-flat-button type="button" (click)="resume(h)"><mat-icon>play_arrow</mat-icon> Reprendre</button>
              <button mat-icon-button type="button" (click)="drop(h)" aria-label="Supprimer"><mat-icon>delete</mat-icon></button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="4" class="empty">Aucune vente en attente.</td></tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: './sales-page.scss',
})
export class HeldPage {
  private readonly local = inject(LocalDbService);
  private readonly router = inject(Router);
  protected readonly held = signal<HeldSale[]>([]);

  constructor() {
    void this.load();
  }

  protected resume(sale: HeldSale): void {
    void this.router.navigate(['/caisse/nouvelle-vente'], { queryParams: { attente: sale.id } });
  }

  protected async drop(sale: HeldSale): Promise<void> {
    if (confirm(`Supprimer la vente en attente « ${sale.label} » ?`)) {
      await this.local.db.held_sales.delete(sale.id);
      await this.load();
    }
  }

  private async load(): Promise<void> {
    this.held.set(await this.local.db.held_sales.orderBy('createdAt').reverse().toArray());
  }
}
