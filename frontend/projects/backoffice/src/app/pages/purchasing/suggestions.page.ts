import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import {
  AuthService,
  Depot,
  DeviceService,
  FcfaPipe,
  NetworkStatusService,
  PurchasingApiService,
  ReorderSuggestion,
  StockApiService,
  Supplier,
  apiErrorMessage,
  defaultDepotId,
} from '@librairie/shared';

export interface SuggestionRow extends ReorderSuggestion {
  selected: boolean;
  quantity: number;
  supplierId: string | null;
}

/** Regroupe les lignes sélectionnées par fournisseur (un bon de commande par fournisseur). */
export function groupBySupplier(rows: SuggestionRow[]): Map<string, SuggestionRow[]> {
  const groups = new Map<string, SuggestionRow[]>();
  for (const row of rows.filter((r) => r.selected && r.quantity > 0 && r.supplierId)) {
    groups.set(row.supplierId as string, [...(groups.get(row.supplierId as string) ?? []), row]);
  }
  return groups;
}

@Component({
  selector: 'bo-suggestions-page',
  imports: [FormsModule, MatCheckboxModule, MatSelectModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Suggestions de réapprovisionnement</h1>
      @if (canManage) {
        <button mat-flat-button type="button" (click)="createOrders()" [disabled]="!selectedCount() || busy() || !network.online()">
          <mat-icon>add_shopping_cart</mat-icon> Créer {{ orderCount() }} bon(s) de commande
        </button>
      }
    </header>
    <p class="muted">
      Un article est proposé quand son stock disponible plus les quantités déjà commandées passe sous le point de commande
      (seuil d'alerte + ventes pendant le délai du fournisseur). La quantité vise le stock maximum, ou le seuil plus
      {{ coverage }} jours de ventes.
    </p>
    <div class="filters">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Fournisseur</mat-label>
        <mat-select [(ngModel)]="supplierFilter" (selectionChange)="load()">
          <mat-option value="">Tous</mat-option>
          @for (s of suppliers(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Couverture (jours)</mat-label>
        <input matInput type="number" min="7" max="180" [(ngModel)]="coverage" (change)="load()" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Dépôt de livraison</mat-label>
        <mat-select [(ngModel)]="depot">
          @for (d of depots(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
        </mat-select>
      </mat-form-field>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="table-wrapper">
      <table class="lines">
        <thead>
          <tr>
            <th><mat-checkbox [checked]="allSelected()" (change)="selectAll($event.checked)" aria-label="Tout sélectionner" /></th>
            <th>Article</th><th class="num">Disponible</th><th class="num">En commande</th><th class="num">Ventes / jour</th>
            <th class="num">Point de commande</th><th class="num">À commander</th><th>Fournisseur</th><th class="num">Montant</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.article; let i = $index) {
            <tr>
              <td><mat-checkbox [checked]="row.selected" (change)="patch(i, { selected: $event.checked })" [aria-label]="row.article_name" /></td>
              <td><code>{{ row.article_code }}</code> {{ row.article_name }}</td>
              <td class="num">{{ row.available }}</td>
              <td class="num">{{ row.on_order || '—' }}</td>
              <td class="num">{{ row.daily_sales }}</td>
              <td class="num">{{ row.reorder_point }}</td>
              <td class="num"><input type="number" min="0" [value]="row.quantity" (change)="patch(i, { quantity: +$any($event.target).value })"
                                     [attr.aria-label]="'Quantité ' + row.article_name" /></td>
              <td>
                <select [value]="row.supplierId ?? ''" (change)="patch(i, { supplierId: $any($event.target).value || null })"
                        [attr.aria-label]="'Fournisseur ' + row.article_name">
                  <option value="">— choisir —</option>
                  @for (s of suppliers(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
                </select>
              </td>
              <td class="num">{{ row.quantity * row.unit_cost | fcfa }}</td>
            </tr>
          } @empty {
            <tr><td colspan="9" class="empty">Aucun article à réapprovisionner.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styleUrl: '../catalog/catalog-page.scss',
  styles: `
    .lines {
      width: 100%;
      border-collapse: collapse;
    }
    .lines th,
    .lines td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: left;
    }
    .lines .num {
      text-align: right;
    }
    input,
    select {
      font: inherit;
      padding: 4px;
      background: transparent;
      color: inherit;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
    }
    input {
      width: 80px;
      text-align: right;
    }
  `,
})
export class SuggestionsPage {
  private readonly api = inject(PurchasingApiService);
  private readonly stockApi = inject(StockApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly device = inject(DeviceService).device;
  protected readonly network = inject(NetworkStatusService);
  protected readonly canManage = inject(AuthService).hasPermission('purchasing.manage');

  protected readonly rows = signal<SuggestionRow[]>([]);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly depots = signal<Depot[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly selectedCount = computed(() => this.rows().filter((r) => r.selected).length);
  protected readonly allSelected = computed(() => this.rows().length > 0 && this.selectedCount() === this.rows().length);
  protected readonly orderCount = computed(() => groupBySupplier(this.rows()).size);
  protected supplierFilter = '';
  protected coverage = 30;
  protected depot = '';

  constructor() {
    this.api.listSuppliers({ is_active: true }).subscribe((page) => this.suppliers.set(page.results));
    this.stockApi.listDepots().subscribe((depots) => {
      this.depots.set(depots.filter((d) => d.is_active));
      this.depot = defaultDepotId(depots, this.device()?.depot) ?? '';
    });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.api.suggestions({ supplier: this.supplierFilter, coverage_days: this.coverage }).subscribe({
      next: (suggestions) => {
        this.rows.set(suggestions.map((s) => ({ ...s, selected: !!s.supplier, quantity: s.suggested_quantity,
          supplierId: s.supplier })));
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
      },
    });
  }

  protected patch(index: number, changes: Partial<SuggestionRow>): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  }

  protected selectAll(selected: boolean): void {
    this.rows.update((rows) => rows.map((row) => ({ ...row, selected })));
  }

  protected createOrders(): void {
    const missing = this.rows().filter((r) => r.selected && !r.supplierId);
    if (missing.length) {
      this.snack.open(`Choisissez un fournisseur pour ${missing.length} article(s) sélectionné(s).`, 'Fermer');
      return;
    }
    const items = [...groupBySupplier(this.rows()).values()].flat().map((row) => ({
      article: row.article, supplier: row.supplierId as string, quantity: row.quantity, unit_cost: row.unit_cost,
    }));
    this.busy.set(true);
    this.api.createOrdersFromSuggestions(this.depot, items).subscribe({
      next: (orders) => {
        this.busy.set(false);
        this.snack.open(`${orders.length} bon(s) de commande créé(s) en brouillon.`);
        void this.router.navigate(['/achats/bons-de-commande']);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
      },
    });
  }
}
