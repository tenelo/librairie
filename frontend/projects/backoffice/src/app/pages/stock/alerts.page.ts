import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { AuthService, StockAlert, StockApiService } from '@librairie/shared';

@Component({
  selector: 'bo-alerts-page',
  imports: [DatePipe, RouterLink, MatTableModule, MatSlideToggleModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Alertes de stock</h1>
      <div class="actions">
        <button mat-stroked-button type="button" (click)="recompute()">Recalculer</button>
        <mat-slide-toggle [checked]="showResolved()" (change)="toggle($event.checked)">Afficher l'historique</mat-slide-toggle>
        @if (canOrder) {
          <a mat-stroked-button routerLink="/achats/suggestions">Suggestions de réapprovisionnement</a>
        }
      </div>
    </header>
    <table mat-table [dataSource]="alerts()">
      <ng-container matColumnDef="kind">
        <th mat-header-cell *matHeaderCellDef>Alerte</th>
        <td mat-cell *matCellDef="let a"><span class="badge" [class]="'badge ' + a.kind">{{ a.kind_label }}</span></td>
      </ng-container>
      <ng-container matColumnDef="article">
        <th mat-header-cell *matHeaderCellDef>Article</th>
        <td mat-cell *matCellDef="let a"><code>{{ a.article_code }}</code> {{ a.article_name }}</td>
      </ng-container>
      <ng-container matColumnDef="available">
        <th mat-header-cell *matHeaderCellDef class="num">Disponible / seuil</th>
        <td mat-cell *matCellDef="let a" class="num">{{ a.available }} / {{ a.threshold }}</td>
      </ng-container>
      <ng-container matColumnDef="since">
        <th mat-header-cell *matHeaderCellDef>Depuis</th>
        <td mat-cell *matCellDef="let a">{{ a.created_at | date: 'dd/MM/yyyy HH:mm' }}
          @if (a.resolved_at) { <br /><small class="muted">résolue le {{ a.resolved_at | date: 'dd/MM/yyyy HH:mm' }}</small> }
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns" [class.inactive]="!!row.resolved_at"></tr>
      <tr class="mat-row" *matNoDataRow><td class="mat-cell empty" [attr.colspan]="columns.length">Aucune alerte en cours.</td></tr>
    </table>
  `,
  styleUrl: '../catalog/catalog-page.scss',
  styles: `
    .badge {
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 13px;
    }
    .badge.LOW {
      background: rgba(239, 108, 0, 0.2);
    }
    .badge.OUT {
      background: rgba(198, 40, 40, 0.2);
    }
  `,
})
export class AlertsPage {
  private readonly api = inject(StockApiService);
  protected readonly canOrder = inject(AuthService).hasPermission('purchasing.view');
  protected readonly columns = ['kind', 'article', 'available', 'since'];
  protected readonly alerts = signal<StockAlert[]>([]);
  protected readonly showResolved = signal(false);

  constructor() {
    this.load();
  }

  protected toggle(value: boolean): void {
    this.showResolved.set(value);
    this.load();
  }

  protected recompute(): void {
    this.api.refreshAlerts().subscribe(() => this.load());
  }

  private load(): void {
    this.api.alerts(this.showResolved()).subscribe((page) => this.alerts.set(page.results));
  }
}
