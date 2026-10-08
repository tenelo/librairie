import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import {
  Depot,
  FcfaPipe,
  MOVEMENT_KIND_LABELS,
  MovementKind,
  StockApiService,
  StockMovement,
  apiErrorMessage,
} from '@librairie/shared';

/** Journal des mouvements de stock (lecture seule), filtrable par type, dépôt et période. */
@Component({
  selector: 'bo-movements-page',
  imports: [FormsModule, DatePipe, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatIconModule, MatProgressBarModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ title() }}</h1>
    <div class="filters">
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-label>Rechercher</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input matInput [(ngModel)]="search" (keyup.enter)="reload(0)" placeholder="Article, référence, motif" />
      </mat-form-field>
      @if (!fixedKinds().length) {
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="kinds" multiple (selectionChange)="reload(0)">
            @for (k of allKinds; track k) {
              <mat-option [value]="k">{{ kindLabels[k] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      }
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Dépôt</mat-label>
        <mat-select [(ngModel)]="depot" (selectionChange)="reload(0)">
          <mat-option value="">Tous</mat-option>
          @for (d of depots(); track d.id) {
            <mat-option [value]="d.id">{{ d.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Du</mat-label>
        <input matInput type="date" [(ngModel)]="dateFrom" (change)="reload(0)" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Au</mat-label>
        <input matInput type="date" [(ngModel)]="dateTo" (change)="reload(0)" />
      </mat-form-field>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="table-wrapper">
      <table mat-table [dataSource]="rows()">
        <ng-container matColumnDef="date">
          <th mat-header-cell *matHeaderCellDef>Date</th>
          <td mat-cell *matCellDef="let m">{{ m.occurred_at | date: 'dd/MM/yyyy HH:mm' }}</td>
        </ng-container>
        <ng-container matColumnDef="kind">
          <th mat-header-cell *matHeaderCellDef>Mouvement</th>
          <td mat-cell *matCellDef="let m">{{ m.kind_label }}<br /><small class="muted">{{ m.reason }}</small></td>
        </ng-container>
        <ng-container matColumnDef="article">
          <th mat-header-cell *matHeaderCellDef>Article</th>
          <td mat-cell *matCellDef="let m"><code>{{ m.article_code }}</code> {{ m.article_name }}</td>
        </ng-container>
        <ng-container matColumnDef="depot">
          <th mat-header-cell *matHeaderCellDef>Dépôt</th>
          <td mat-cell *matCellDef="let m">{{ m.depot_code }}</td>
        </ng-container>
        <ng-container matColumnDef="quantity">
          <th mat-header-cell *matHeaderCellDef class="num">Quantité</th>
          <td mat-cell *matCellDef="let m" class="num" [style.color]="m.quantity < 0 ? 'var(--mat-sys-error)' : null">
            {{ m.quantity > 0 ? '+' : '' }}{{ m.quantity }}</td>
        </ng-container>
        <ng-container matColumnDef="value">
          <th mat-header-cell *matHeaderCellDef class="num">Valeur</th>
          <td mat-cell *matCellDef="let m" class="num">{{ m.quantity * m.unit_cost | fcfa }}</td>
        </ng-container>
        <ng-container matColumnDef="ref">
          <th mat-header-cell *matHeaderCellDef>Référence</th>
          <td mat-cell *matCellDef="let m">{{ m.reference }}<br /><small class="muted">{{ m.user_name }}</small></td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr class="mat-row" *matNoDataRow><td class="mat-cell empty" [attr.colspan]="columns.length">Aucun mouvement.</td></tr>
      </table>
    </div>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="pageSize" [hidePageSize]="true" (page)="onPage($event)" />
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class MovementsPage implements OnInit {
  private readonly api = inject(StockApiService);
  private readonly snack = inject(MatSnackBar);

  /** Titre et types imposés (réutilisé par d'autres écrans, ex. historique des pertes). */
  readonly title = input('Mouvements de stock');
  readonly fixedKinds = input<MovementKind[]>([]);

  protected readonly kindLabels = MOVEMENT_KIND_LABELS;
  protected readonly allKinds = Object.keys(MOVEMENT_KIND_LABELS) as MovementKind[];
  protected readonly columns = ['date', 'kind', 'article', 'depot', 'quantity', 'value', 'ref'];
  protected readonly pageSize = 50;
  protected readonly rows = signal<StockMovement[]>([]);
  protected readonly depots = signal<Depot[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly loading = signal(false);
  protected search = '';
  protected kinds: MovementKind[] = [];
  protected depot = '';
  protected dateFrom = '';
  protected dateTo = '';

  ngOnInit(): void {
    this.api.listDepots().subscribe((depots) => this.depots.set(depots));
    this.reload(0);
  }

  reload(page: number): void {
    this.page.set(page);
    this.loading.set(true);
    const kinds = this.fixedKinds().length ? this.fixedKinds() : this.kinds;
    this.api
      .movements({
        page: page + 1,
        page_size: this.pageSize,
        search: this.search.trim(),
        kind: kinds,
        depot: this.depot,
        date_from: this.dateFrom ? `${this.dateFrom}T00:00:00Z` : null,
        date_to: this.dateTo ? `${this.dateTo}T23:59:59Z` : null,
      })
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

  protected onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }
}
