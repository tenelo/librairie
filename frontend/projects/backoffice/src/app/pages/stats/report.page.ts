import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { Depot, SimpleChartComponent, StockApiService, apiErrorMessage, saveBlob } from '@librairie/shared';

import { formatValue, formatVariation, presetRange } from './report-format';
import { ReportData, ReportFilters, ReportTable, ReportsApiService } from './reports-api.service';
import { ScheduledReportsComponent } from './scheduled-reports.component';

/** Rapport affiché selon l'écran du menu Statistiques. */
export const REPORT_BY_PATH: Record<string, string> = {
  ventes: 'sales', kits: 'kits', stock: 'stock', commandes: 'orders', caisses: 'cash', inventaires: 'inventories',
};

const SALES_GROUPS = [
  { code: 'day', label: 'Jour' }, { code: 'hour', label: 'Heure' }, { code: 'weekday', label: 'Jour de semaine' },
  { code: 'article', label: 'Article' }, { code: 'category', label: 'Catégorie' }, { code: 'type', label: 'Type' },
  { code: 'cashier', label: 'Caissier' }, { code: 'device', label: 'Terminal' }, { code: 'payment', label: 'Paiement' },
  { code: 'channel', label: 'Canal' },
];

/** Rapport statistique : filtres de période et de dépôt, indicateurs, graphiques, tableaux, exports. */
@Component({
  selector: 'bo-report-page',
  imports: [FormsModule, MatButtonModule, MatButtonToggleModule, MatCardModule, MatIconModule, SimpleChartComponent,
    ScheduledReportsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Statistiques · {{ data()?.title ?? '…' }}</h1>
      <div class="toolbar">
        <button mat-stroked-button type="button" (click)="download('xlsx')" [disabled]="!data()"><mat-icon>table_view</mat-icon> Excel</button>
        <button mat-stroked-button type="button" (click)="download('pdf')" [disabled]="!data()"><mat-icon>picture_as_pdf</mat-icon> PDF</button>
      </div>
    </header>
    <div class="filters">
      <mat-button-toggle-group [value]="preset()" (change)="applyPreset($event.value)" aria-label="Période">
        <mat-button-toggle value="today">Aujourd'hui</mat-button-toggle>
        <mat-button-toggle value="7d">7 jours</mat-button-toggle>
        <mat-button-toggle value="30d">30 jours</mat-button-toggle>
        <mat-button-toggle value="month">Mois en cours</mat-button-toggle>
        <mat-button-toggle value="year">Année</mat-button-toggle>
      </mat-button-toggle-group>
      <label>Du <input type="date" [(ngModel)]="filters.date_from" (change)="custom()" /></label>
      <label>au <input type="date" [(ngModel)]="filters.date_to" (change)="custom()" /></label>
      <label>Dépôt
        <select [(ngModel)]="filters.depot" (change)="load()">
          <option [ngValue]="null">Tous</option>
          @for (d of depots(); track d.id) { <option [ngValue]="d.id">{{ d.name }}</option> }
        </select>
      </label>
    </div>
    @if (name === 'sales') {
      <div class="groups" role="group" aria-label="Analyses affichées">
        @for (g of salesGroups; track g.code) {
          <label><input type="checkbox" [checked]="groups().includes(g.code)" (change)="toggleGroup(g.code)" /> {{ g.label }}</label>
        }
      </div>
    }

    @if (data(); as d) {
      <div class="kpis">
        @for (item of d.summary; track item.label) {
          <div>
            <span>{{ item.label }}</span>
            <strong>{{ format(item.value, item.kind) }}</strong>
            @if (item.variation !== undefined && item.variation !== null) {
              <small [class.up]="item.variation > 0" [class.down]="item.variation < 0">
                {{ variation(item.variation) }} vs période précédente</small>
            }
          </div>
        }
      </div>
      @for (t of d.tables; track t.key) {
        <mat-card appearance="outlined" class="block">
          <mat-card-header><mat-card-title>{{ t.title }}</mat-card-title></mat-card-header>
          <mat-card-content>
            @if (t.chart && t.rows.length) {
              <lib-simple-chart [rows]="t.rows" [x]="t.chart.x" [y]="t.chart.y" [type]="t.chart.type"
                                [kind]="kindOf(t, t.chart.y)" [limit]="t.chart.limit" [label]="t.title" />
            }
            <div class="table-wrap">
              <table class="list">
                <thead><tr>@for (c of t.columns; track c.key) { <th [class.num]="c.kind !== 'text' && c.kind !== 'date'">{{ c.label }}</th> }</tr></thead>
                <tbody>
                  @for (row of visibleRows(t); track $index) {
                    <tr>@for (c of t.columns; track c.key) {
                      <td [class.num]="c.kind !== 'text' && c.kind !== 'date'" [class.error]="c.kind === 'money' && $any(row[c.key]) < 0">{{ format(row[c.key], c.kind) }}</td>
                    }</tr>
                  } @empty {
                    <tr><td [attr.colspan]="t.columns.length" class="empty">Aucune donnée sur la période.</td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (t.rows.length > 25) {
              <button mat-button type="button" (click)="toggleExpand(t.key)">
                {{ expanded().includes(t.key) ? 'Réduire' : 'Afficher les ' + t.rows.length + ' lignes' }}</button>
            }
          </mat-card-content>
        </mat-card>
      }
      <bo-scheduled-reports [report]="name" [depot]="filters.depot ?? null" />
    } @else {
      <p>{{ error() ?? 'Calcul en cours…' }}</p>
    }
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .filters, .groups { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
    .filters input, .filters select { font: inherit; padding: 4px; }
    .kpis small { display: block; font-size: 12px; opacity: 0.8; }
    .kpis small.up { color: #2e7d32; opacity: 1; }
    .kpis small.down { color: var(--mat-sys-error); opacity: 1; }
    .block { margin-top: 16px; }
    .table-wrap { overflow-x: auto; }
  `,
})
export class ReportPage implements OnInit {
  private readonly api = inject(ReportsApiService);
  private readonly stock = inject(StockApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly name = REPORT_BY_PATH[inject(ActivatedRoute).snapshot.routeConfig?.path ?? 'ventes'] ?? 'sales';
  protected readonly salesGroups = SALES_GROUPS;
  protected readonly data = signal<ReportData | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly depots = signal<Depot[]>([]);
  protected readonly preset = signal<string | null>('30d');
  protected readonly groups = signal<string[]>(['day', 'channel', 'payment', 'category']);
  protected readonly expanded = signal<string[]>([]);
  protected filters: ReportFilters = { ...presetRange('30d'), depot: null };

  ngOnInit(): void {
    this.stock.listDepots().subscribe({ next: (d) => this.depots.set(d), error: () => undefined });
    this.load();
  }

  protected load(): void {
    this.error.set(null);
    const filters = this.name === 'sales' ? { ...this.filters, groups: this.groups().join(',') } : this.filters;
    this.api.report(this.name, filters).subscribe({
      next: (data) => this.data.set(data),
      error: (err: unknown) => {
        this.data.set(null);
        this.error.set(apiErrorMessage(err));
      },
    });
  }

  protected applyPreset(preset: 'today' | '7d' | '30d' | 'month' | 'year'): void {
    this.preset.set(preset);
    this.filters = { ...this.filters, ...presetRange(preset) };
    this.load();
  }

  protected custom(): void {
    this.preset.set(null);
    this.load();
  }

  protected toggleGroup(code: string): void {
    this.groups.update((g) => (g.includes(code) ? g.filter((c) => c !== code) : [...g, code]));
    this.load();
  }

  protected toggleExpand(key: string): void {
    this.expanded.update((e) => (e.includes(key) ? e.filter((k) => k !== key) : [...e, key]));
  }

  protected visibleRows(table: ReportTable): Record<string, unknown>[] {
    return this.expanded().includes(table.key) ? table.rows : table.rows.slice(0, 25);
  }

  protected kindOf(table: ReportTable, key: string): string {
    return table.columns.find((c) => c.key === key)?.kind ?? 'int';
  }

  protected format = formatValue;
  protected variation = formatVariation;

  protected download(format: 'xlsx' | 'pdf'): void {
    const filters = this.name === 'sales' ? { ...this.filters, groups: this.groups().join(',') } : this.filters;
    this.api.file(this.name, filters, format).subscribe({
      next: (blob) => saveBlob(blob, `${this.name}-${this.filters.date_from}-${this.filters.date_to}.${format}`),
      error: (err: unknown) => this.snack.open(format === 'pdf'
        ? 'PDF indisponible sur ce serveur (WeasyPrint) : utilisez l’export Excel.' : apiErrorMessage(err), 'Fermer',
      { duration: 8000 }),
    });
  }
}
