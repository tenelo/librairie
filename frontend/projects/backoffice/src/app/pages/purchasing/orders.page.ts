import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import {
  AuthService,
  FcfaPipe,
  PURCHASE_ORDER_STATUS_LABELS,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchasingApiService,
  Supplier,
} from '@librairie/shared';

@Component({
  selector: 'bo-orders-page',
  imports: [FormsModule, DatePipe, RouterLink, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Bons de commande</h1>
      @if (canManage) {
        <a mat-flat-button routerLink="nouveau"><mat-icon>add</mat-icon> Nouveau bon</a>
      }
    </header>
    <div class="filters">
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-label>Rechercher</mat-label>
        <input matInput [(ngModel)]="search" (keyup.enter)="reload(0)" placeholder="N°, fournisseur" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Fournisseur</mat-label>
        <mat-select [(ngModel)]="supplier" (selectionChange)="reload(0)">
          <mat-option value="">Tous</mat-option>
          @for (s of suppliers(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Statut</mat-label>
        <mat-select [(ngModel)]="status" (selectionChange)="reload(0)">
          <mat-option value="">Tous</mat-option>
          @for (s of statuses; track s) { <mat-option [value]="s">{{ statusLabels[s] }}</mat-option> }
        </mat-select>
      </mat-form-field>
    </div>
    <table mat-table [dataSource]="rows()">
      <ng-container matColumnDef="number">
        <th mat-header-cell *matHeaderCellDef>N°</th>
        <td mat-cell *matCellDef="let o"><strong>{{ o.number }}</strong><br /><small class="muted">{{ o.order_date | date: 'dd/MM/yyyy' }}</small></td>
      </ng-container>
      <ng-container matColumnDef="supplier">
        <th mat-header-cell *matHeaderCellDef>Fournisseur</th>
        <td mat-cell *matCellDef="let o">{{ o.supplier_name }}<br /><small class="muted">livraison {{ o.depot_code }}
          @if (o.expected_date) { · prévue le {{ o.expected_date | date: 'dd/MM' }} }</small></td>
      </ng-container>
      <ng-container matColumnDef="total">
        <th mat-header-cell *matHeaderCellDef class="num">Montant</th>
        <td mat-cell *matCellDef="let o" class="num">{{ o.total | fcfa }}</td>
      </ng-container>
      <ng-container matColumnDef="status">
        <th mat-header-cell *matHeaderCellDef>Statut</th>
        <td mat-cell *matCellDef="let o"><span class="badge" [class]="'badge ' + o.status">{{ o.status_label }}</span></td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns" class="clickable" (click)="open(row)"></tr>
      <tr class="mat-row" *matNoDataRow><td class="mat-cell empty" [attr.colspan]="columns.length">Aucun bon de commande.</td></tr>
    </table>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="50" [hidePageSize]="true" (page)="onPage($event)" />
  `,
  styleUrl: '../catalog/catalog-page.scss',
  styles: `
    .badge {
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 13px;
      background: var(--mat-sys-surface-container-high);
    }
    .badge.SENT,
    .badge.PARTIAL {
      background: rgba(239, 108, 0, 0.18);
    }
    .badge.RECEIVED {
      background: rgba(46, 125, 50, 0.18);
    }
  `,
})
export class OrdersPage {
  private readonly api = inject(PurchasingApiService);
  private readonly router = inject(Router);
  protected readonly canManage = inject(AuthService).hasPermission('purchasing.manage');
  protected readonly statusLabels = PURCHASE_ORDER_STATUS_LABELS;
  protected readonly statuses = Object.keys(PURCHASE_ORDER_STATUS_LABELS) as PurchaseOrderStatus[];
  protected readonly columns = ['number', 'supplier', 'total', 'status'];
  protected readonly rows = signal<PurchaseOrder[]>([]);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected search = '';
  protected supplier = '';
  protected status = '';

  constructor() {
    this.api.listSuppliers().subscribe((page) => this.suppliers.set(page.results));
    this.reload(0);
  }

  reload(page: number): void {
    this.page.set(page);
    this.api.listOrders({ page: page + 1, search: this.search.trim(), supplier: this.supplier, status: this.status })
      .subscribe((result) => {
        this.rows.set(result.results);
        this.total.set(result.count);
      });
  }

  protected onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }

  protected open(order: PurchaseOrder): void {
    void this.router.navigate(['/achats/bons-de-commande', order.id]);
  }
}
