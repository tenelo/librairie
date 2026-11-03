import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import { AuthService, StockApiService, StockTransfer } from '@librairie/shared';

@Component({
  selector: 'bo-transfers-page',
  imports: [FormsModule, DatePipe, RouterLink, MatTableModule, MatPaginatorModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Transferts entre dépôts</h1>
      @if (canTransfer) {
        <a mat-flat-button routerLink="nouveau"><mat-icon>add</mat-icon> Nouveau transfert</a>
      }
    </header>
    <div class="filters">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Statut</mat-label>
        <mat-select [(ngModel)]="status" (selectionChange)="reload(0)">
          <mat-option value="">Tous</mat-option>
          <mat-option value="DRAFT">Brouillons</mat-option>
          <mat-option value="VALIDATED">Validés</mat-option>
          <mat-option value="CANCELLED">Annulés</mat-option>
        </mat-select>
      </mat-form-field>
    </div>
    <table mat-table [dataSource]="rows()">
      <ng-container matColumnDef="number">
        <th mat-header-cell *matHeaderCellDef>N°</th>
        <td mat-cell *matCellDef="let t"><strong>{{ t.number }}</strong><br /><small class="muted">{{ t.created_at | date: 'dd/MM/yyyy' }}</small></td>
      </ng-container>
      <ng-container matColumnDef="route">
        <th mat-header-cell *matHeaderCellDef>Trajet</th>
        <td mat-cell *matCellDef="let t">{{ t.from_depot_name }} → {{ t.to_depot_name }}</td>
      </ng-container>
      <ng-container matColumnDef="lines">
        <th mat-header-cell *matHeaderCellDef class="num">Articles</th>
        <td mat-cell *matCellDef="let t" class="num">{{ t.lines.length }}</td>
      </ng-container>
      <ng-container matColumnDef="status">
        <th mat-header-cell *matHeaderCellDef>Statut</th>
        <td mat-cell *matCellDef="let t">{{ t.status_label }}</td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns" class="clickable" (click)="open(row)"></tr>
      <tr class="mat-row" *matNoDataRow><td class="mat-cell empty" [attr.colspan]="columns.length">Aucun transfert.</td></tr>
    </table>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="50" [hidePageSize]="true" (page)="onPage($event)" />
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class TransfersPage {
  private readonly api = inject(StockApiService);
  private readonly router = inject(Router);
  protected readonly canTransfer = inject(AuthService).hasPermission('stock.transfer');
  protected readonly columns = ['number', 'route', 'lines', 'status'];
  protected readonly rows = signal<StockTransfer[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected status = '';

  constructor() {
    this.reload(0);
  }

  reload(page: number): void {
    this.page.set(page);
    this.api.listTransfers({ page: page + 1, status: this.status }).subscribe((result) => {
      this.rows.set(result.results);
      this.total.set(result.count);
    });
  }

  protected onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }

  protected open(transfer: StockTransfer): void {
    void this.router.navigate(['/stock/transferts', transfer.id]);
  }
}
