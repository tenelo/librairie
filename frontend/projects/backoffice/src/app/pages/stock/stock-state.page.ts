import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import {
  CatalogApiService,
  Category,
  Depot,
  FcfaPipe,
  STOCK_STATUS_LABELS,
  StockApiService,
  StockStateRow,
  StockStatus,
  StockSummary,
  apiErrorMessage,
} from '@librairie/shared';

import { StockCardDialogComponent, StockCardDialogData } from './stock-card-dialog.component';

@Component({
  selector: 'bo-stock-state-page',
  imports: [
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatProgressBarModule,
    FcfaPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>État des stocks</h1>
    @if (summary(); as s) {
      <section class="kpis">
        <mat-card appearance="outlined"><mat-card-content><small>Valeur du stock (CMP)</small>
          <strong>{{ s.valuation | fcfa }}</strong></mat-card-content></mat-card>
        <mat-card appearance="outlined" class="clickable" (click)="filterStatus('LOW')"><mat-card-content>
          <small>Stock bas</small><strong class="low">{{ s.low }}</strong></mat-card-content></mat-card>
        <mat-card appearance="outlined" class="clickable" (click)="filterStatus('OUT')"><mat-card-content>
          <small>Ruptures</small><strong class="out">{{ s.out }}</strong></mat-card-content></mat-card>
      </section>
    }
    <div class="filters">
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-label>Rechercher ou scanner</mat-label>
        <mat-icon matPrefix>qr_code_scanner</mat-icon>
        <input matInput [(ngModel)]="search" (keyup.enter)="reload(0)" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Dépôt</mat-label>
        <mat-select [(ngModel)]="depot" (selectionChange)="reload(0); loadSummary()">
          <mat-option value="">Tous les dépôts</mat-option>
          @for (d of depots(); track d.id) {
            <mat-option [value]="d.id">{{ d.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Catégorie</mat-label>
        <mat-select [(ngModel)]="category" (selectionChange)="reload(0)">
          <mat-option value="">Toutes</mat-option>
          @for (c of categories(); track c.id) {
            <mat-option [value]="c.id">{{ c.path }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Statut</mat-label>
        <mat-select [(ngModel)]="status" (selectionChange)="reload(0)">
          <mat-option value="">Tous</mat-option>
          <mat-option value="OK">Disponible</mat-option>
          <mat-option value="LOW">Stock bas</mat-option>
          <mat-option value="OUT">Rupture</mat-option>
        </mat-select>
      </mat-form-field>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="table-wrapper">
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Article</th>
          <td mat-cell *matCellDef="let r"><strong>{{ r.name }}</strong><br />
            <small class="muted"><code>{{ r.code }}</code> · {{ r.category_path || 'Sans catégorie' }}</small></td>
        </ng-container>
        <ng-container matColumnDef="quantity">
          <th mat-header-cell *matHeaderCellDef class="num">Physique</th>
          <td mat-cell *matCellDef="let r" class="num">{{ r.quantity }}</td>
        </ng-container>
        <ng-container matColumnDef="reserved">
          <th mat-header-cell *matHeaderCellDef class="num">Réservé</th>
          <td mat-cell *matCellDef="let r" class="num">{{ r.reserved || '—' }}</td>
        </ng-container>
        <ng-container matColumnDef="available">
          <th mat-header-cell *matHeaderCellDef class="num">Disponible</th>
          <td mat-cell *matCellDef="let r" class="num"><strong>{{ r.available }}</strong>
            <br /><small class="muted">seuil {{ r.alert_threshold }}</small></td>
        </ng-container>
        <ng-container matColumnDef="value">
          <th mat-header-cell *matHeaderCellDef class="num">Valeur (CMP)</th>
          <td mat-cell *matCellDef="let r" class="num">{{ r.value | fcfa }}<br />
            <small class="muted">{{ r.avg_cost | fcfa }} / u</small></td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Statut</th>
          <td mat-cell *matCellDef="let r">
            <span class="badge" [class]="'badge ' + r.status">{{ statusLabel(r.status) }}</span>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="clickable" (click)="openCard(row)"></tr>
        <tr class="mat-row" *matNoDataRow><td class="mat-cell empty" [attr.colspan]="columns.length">Aucun article.</td></tr>
      </table>
    </div>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="pageSize" [hidePageSize]="true" (page)="onPage($event)" />
  `,
  styleUrl: '../catalog/catalog-page.scss',
  styles: `
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .kpis mat-card-content {
      display: flex;
      flex-direction: column;
    }
    .kpis strong {
      font-size: 22px;
    }
    .low {
      color: #ef6c00;
    }
    .out {
      color: var(--mat-sys-error);
    }
    .badge {
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 13px;
      white-space: nowrap;
    }
    .badge.OK {
      background: rgba(46, 125, 50, 0.15);
    }
    .badge.LOW {
      background: rgba(239, 108, 0, 0.2);
    }
    .badge.OUT {
      background: rgba(198, 40, 40, 0.2);
    }
  `,
})
export class StockStatePage {
  private readonly api = inject(StockApiService);
  private readonly catalog = inject(CatalogApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly statusLabels = STOCK_STATUS_LABELS;
  protected readonly columns = ['name', 'quantity', 'reserved', 'available', 'value', 'status'];
  protected readonly pageSize = 50;
  protected readonly rows = signal<StockStateRow[]>([]);
  protected readonly depots = signal<Depot[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly summary = signal<StockSummary | null>(null);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly loading = signal(false);
  protected search = '';
  protected depot = '';
  protected category = '';
  protected status: StockStatus | '' = '';

  constructor() {
    this.api.listDepots().subscribe((depots) => this.depots.set(depots));
    this.catalog.listCategories().subscribe((categories) => this.categories.set(categories));
    this.loadSummary();
    this.reload(0);
  }

  loadSummary(): void {
    this.api.summary(this.depot || undefined).subscribe((summary) => this.summary.set(summary));
  }

  reload(page: number): void {
    this.page.set(page);
    this.loading.set(true);
    this.api
      .state({ page: page + 1, page_size: this.pageSize, search: this.search.trim(), depot: this.depot,
        category: this.category, status: this.status })
      .subscribe({
        next: (result) => {
          this.rows.set(result.results);
          this.total.set(result.count);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
        },
      });
  }

  protected statusLabel(status: StockStatus): string {
    return this.statusLabels[status];
  }

  protected filterStatus(status: StockStatus): void {
    this.status = status;
    this.reload(0);
  }

  protected onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }

  protected openCard(row: StockStateRow): void {
    const data: StockCardDialogData = { articleId: row.id, articleName: row.name, depots: this.depots(), depot: this.depot };
    this.dialog.open(StockCardDialogComponent, { data, width: '900px', maxWidth: '96vw' });
  }
}
