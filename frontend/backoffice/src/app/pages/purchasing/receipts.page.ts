import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import { AuthService, FcfaPipe, GoodsReceipt, PurchasingApiService } from '@librairie/shared';

@Component({
  selector: 'bo-receipts-page',
  imports: [FormsModule, DatePipe, RouterLink, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Réceptions</h1>
      @if (canReceive) {
        <a mat-flat-button routerLink="nouvelle"><mat-icon>add</mat-icon> Nouvelle réception</a>
      }
    </header>
    <div class="filters">
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-label>Rechercher</mat-label>
        <input matInput [(ngModel)]="search" (keyup.enter)="reload(0)" placeholder="N°, fournisseur, bon de livraison" />
      </mat-form-field>
    </div>
    <table mat-table [dataSource]="rows()">
      <ng-container matColumnDef="number">
        <th mat-header-cell *matHeaderCellDef>N°</th>
        <td mat-cell *matCellDef="let r"><strong>{{ r.number }}</strong><br /><small class="muted">{{ r.received_at | date: 'dd/MM/yyyy HH:mm' }}</small></td>
      </ng-container>
      <ng-container matColumnDef="supplier">
        <th mat-header-cell *matHeaderCellDef>Fournisseur</th>
        <td mat-cell *matCellDef="let r">{{ r.supplier_name }}<br /><small class="muted">
          {{ r.purchase_order_number ? 'Commande ' + r.purchase_order_number : 'Sans commande' }}
          @if (r.delivery_note) { · BL {{ r.delivery_note }} }</small></td>
      </ng-container>
      <ng-container matColumnDef="depot">
        <th mat-header-cell *matHeaderCellDef>Dépôt</th>
        <td mat-cell *matCellDef="let r">{{ r.depot_code }}</td>
      </ng-container>
      <ng-container matColumnDef="total">
        <th mat-header-cell *matHeaderCellDef class="num">Montant</th>
        <td mat-cell *matCellDef="let r" class="num">{{ r.total | fcfa }}<br /><small class="muted">{{ r.lines.length }} ligne(s)</small></td>
      </ng-container>
      <ng-container matColumnDef="user">
        <th mat-header-cell *matHeaderCellDef>Par</th>
        <td mat-cell *matCellDef="let r">{{ r.user_name }}</td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns" class="clickable" (click)="open(row)"></tr>
      <tr class="mat-row" *matNoDataRow><td class="mat-cell empty" [attr.colspan]="columns.length">Aucune réception.</td></tr>
    </table>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="50" [hidePageSize]="true" (page)="onPage($event)" />
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class ReceiptsPage {
  private readonly api = inject(PurchasingApiService);
  private readonly router = inject(Router);
  protected readonly canReceive = inject(AuthService).hasPermission('purchasing.receive');
  protected readonly columns = ['number', 'supplier', 'depot', 'total', 'user'];
  protected readonly rows = signal<GoodsReceipt[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected search = '';

  constructor() {
    this.reload(0);
  }

  reload(page: number): void {
    this.page.set(page);
    this.api.listReceipts({ page: page + 1, search: this.search.trim() }).subscribe((result) => {
      this.rows.set(result.results);
      this.total.set(result.count);
    });
  }

  protected onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }

  protected open(receipt: GoodsReceipt): void {
    void this.router.navigate(['/achats/receptions', receipt.id]);
  }
}
