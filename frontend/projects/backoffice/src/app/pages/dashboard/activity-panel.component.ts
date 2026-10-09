import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import {
  AuthService,
  FcfaPipe,
  LocalDbService,
  NetworkStatusService,
  SimpleChartComponent,
} from '@librairie/shared';

import { formatValue, formatVariation } from '../stats/report-format';
import { DashboardData, ReportsApiService } from '../stats/reports-api.service';

export interface LocalDaySummary {
  count: number;
  revenue: number;
  average: number;
}

/** Résumé du jour calculé sur les ventes enregistrées par ce terminal (disponible hors ligne). */
export function localDaySummary(sales: { sold_at: string; total: number }[], today = new Date()): LocalDaySummary {
  const day = today.toDateString();
  const mine = sales.filter((s) => new Date(s.sold_at).toDateString() === day);
  const revenue = mine.reduce((sum, s) => sum + s.total, 0);
  return { count: mine.length, revenue, average: mine.length ? Math.round(revenue / mine.length) : 0 };
}

/** Indicateurs du tableau de bord : consolidés en ligne, résumé local du terminal hors ligne. */
@Component({
  selector: 'bo-activity-panel',
  imports: [RouterLink, MatButtonToggleModule, MatCardModule, MatIconModule, FcfaPipe, SimpleChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2>Activité</h2>
      @if (network.online()) {
        <mat-button-toggle-group [value]="scope()" (change)="scope.set($event.value)" aria-label="Période">
          <mat-button-toggle value="today">Aujourd'hui</mat-button-toggle>
          <mat-button-toggle value="week">Semaine</mat-button-toggle>
          <mat-button-toggle value="month">Mois</mat-button-toggle>
        </mat-button-toggle-group>
      }
    </div>
    @if (network.online() && data(); as d) {
      <div class="kpis">
        @for (k of d.kpis; track k.key) {
          <div><span>{{ k.label }}</span><strong>{{ format(k.value, k.kind) }}</strong>
            @if (k.variation !== null && k.variation !== undefined) {
              <small [class.up]="k.variation > 0" [class.down]="k.variation < 0">{{ variation(k.variation) }} vs période précédente</small>
            }</div>
        }
        <div><span>Alertes stock</span><strong>{{ d.alerts.out }} rupture(s) · {{ d.alerts.low }} bas</strong>
          <small><a routerLink="/stock/alertes">Voir les alertes</a></small></div>
      </div>
      <div class="grid">
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>{{ d.chart.title }}</mat-card-title></mat-card-header>
          <mat-card-content>
            @if (d.chart.rows.length) {
              <lib-simple-chart [rows]="d.chart.rows" x="label" y="revenue" [type]="d.chart.chart?.type ?? 'bar'" kind="money"
                                [label]="'Chiffre d’affaires ' + d.chart.title" />
            } @else { <p class="muted">Aucune vente sur la période.</p> }
          </mat-card-content>
        </mat-card>
        <mat-card appearance="outlined">
          <mat-card-header><mat-card-title>Commandes en ligne en cours</mat-card-title></mat-card-header>
          <mat-card-content>
            <ul class="orders">
              @for (o of d.orders; track o.status) { <li><span>{{ o.label }}</span><strong>{{ o.count }}</strong></li> }
            </ul>
            <a routerLink="/commandes">Gérer les commandes</a>
          </mat-card-content>
        </mat-card>
        @if (d.top) {
          <mat-card appearance="outlined">
            <mat-card-header><mat-card-title>Meilleures ventes</mat-card-title></mat-card-header>
            <mat-card-content>
              <ol class="top">
                @for (r of d.top.rows; track $index) { <li>{{ r['label'] }} <small>· {{ r['quantity'] }} vendu(s) · {{ $any(r['revenue']) | fcfa }}</small></li> }
                @empty { <li class="muted">Aucune vente.</li> }
              </ol>
              <a routerLink="/statistiques/ventes">Toutes les statistiques</a>
            </mat-card-content>
          </mat-card>
        }
      </div>
    } @else if (!network.online()) {
      <p class="muted"><mat-icon inline>wifi_off</mat-icon> Hors ligne : résumé du jour de ce terminal.</p>
      <div class="kpis">
        <div><span>Ventes du jour (ce terminal)</span><strong>{{ localSummary().count }}</strong></div>
        <div><span>Chiffre d'affaires</span><strong>{{ localSummary().revenue | fcfa }}</strong></div>
        <div><span>Panier moyen</span><strong>{{ localSummary().average | fcfa }}</strong></div>
      </div>
    }
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
    .kpis small { display: block; font-size: 12px; opacity: 0.8; }
    .kpis small.up { color: #2e7d32; opacity: 1; }
    .kpis small.down { color: var(--mat-sys-error); opacity: 1; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-top: 16px; }
    .orders { list-style: none; padding: 0; }
    .orders li { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .top { padding-left: 20px; }
    .muted { opacity: 0.7; }
  `,
})
export class ActivityPanelComponent {
  private readonly api = inject(ReportsApiService);
  private readonly db = inject(LocalDbService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly auth = inject(AuthService);
  protected readonly scope = signal<'today' | 'week' | 'month'>('today');
  protected readonly data = signal<DashboardData | null>(null);
  protected readonly localSummary = signal<LocalDaySummary>({ count: 0, revenue: 0, average: 0 });
  protected format = formatValue;
  protected variation = formatVariation;

  constructor() {
    effect(() => {
      const scope = this.scope();
      if (this.network.online()) {
        this.api.dashboard(scope).subscribe({ next: (d) => this.data.set(d), error: () => this.data.set(null) });
      } else {
        void this.loadLocal();
      }
    });
  }

  private async loadLocal(): Promise<void> {
    const sales = await this.db.db.local_sales.toArray();
    this.localSummary.set(localDaySummary(sales.map((s) => ({ sold_at: String(s['sold_at']), total: Number(s['total']) }))));
  }
}
