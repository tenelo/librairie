import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Depot, StockApiService, StockCardLine } from '@librairie/shared';

export interface StockCardDialogData {
  articleId: string;
  articleName: string;
  depots: Depot[];
  depot: string;
}

/** Fiche de stock d'un article : historique des mouvements avec solde progressif. */
@Component({
  selector: 'bo-stock-card-dialog',
  imports: [MatDialogModule, MatButtonModule, MatProgressBarModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Fiche de stock — {{ data.articleName }}</h2>
    <mat-dialog-content>
      <div class="depots">
        <button mat-button type="button" [class.active]="depot() === ''" (click)="load('')">Tous les dépôts</button>
        @for (d of data.depots; track d.id) {
          <button mat-button type="button" [class.active]="depot() === d.id" (click)="load(d.id)">{{ d.name }}</button>
        }
      </div>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <table>
        <thead>
          <tr><th>Date</th><th>Mouvement</th><th>Dépôt</th><th>Référence</th><th class="num">Quantité</th><th class="num">Solde</th></tr>
        </thead>
        <tbody>
          @for (line of lines(); track line.movement.id) {
            <tr>
              <td>{{ line.movement.occurred_at | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>{{ line.movement.kind_label }}<br /><small>{{ line.movement.reason }}</small></td>
              <td>{{ line.movement.depot_code }}</td>
              <td>{{ line.movement.reference }}<br /><small>{{ line.movement.user_name }}</small></td>
              <td class="num" [class.out]="line.movement.quantity < 0">
                {{ line.movement.quantity > 0 ? '+' : '' }}{{ line.movement.quantity }}
              </td>
              <td class="num"><strong>{{ line.balance }}</strong></td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="empty">Aucun mouvement.</td></tr>
          }
        </tbody>
      </table>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-button mat-dialog-close>Fermer</button></mat-dialog-actions>
  `,
  styles: `
    .depots {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .active {
      background: var(--mat-sys-secondary-container);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th,
    td {
      padding: 6px;
      text-align: left;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .num {
      text-align: right;
    }
    .out {
      color: var(--mat-sys-error);
    }
    .empty {
      text-align: center;
      opacity: 0.7;
    }
  `,
})
export class StockCardDialogComponent {
  protected readonly data = inject<StockCardDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(StockApiService);
  protected readonly lines = signal<StockCardLine[]>([]);
  protected readonly depot = signal(this.data.depot);
  protected readonly loading = signal(false);

  constructor() {
    this.load(this.data.depot);
  }

  protected load(depot: string): void {
    this.depot.set(depot);
    this.loading.set(true);
    this.api.card(this.data.articleId, depot || undefined).subscribe({
      next: (lines) => {
        this.lines.set(lines);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
