import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  APP_CONFIG,
  AuthService,
  DeviceService,
  LocalDbService,
  NetworkStatusService,
  SyncEngineService,
  SyncStatusService,
} from '@librairie/shared';

const TABLE_LABELS: Record<string, string> = {
  articles: 'Articles', barcodes: 'Codes-barres', categories: 'Catégories', brands: 'Marques', units: 'Unités',
  kits: 'Kits', kit_components: 'Composants de kits', levels: 'Niveaux', school_years: 'Années scolaires',
  schools: 'Établissements', depots: 'Dépôts', stock_levels: 'Niveaux de stock', settings: 'Paramètres',
  customers: 'Clients', payment_methods: 'Moyens de paiement', online_orders: 'Commandes en ligne',
  cash_sessions: 'Sessions de caisse', suppliers: 'Fournisseurs', purchase_orders: 'Commandes fournisseurs en attente',
};

/** État de la synchronisation de ce terminal et données disponibles hors connexion. */
@Component({
  selector: 'bo-sync-state-page',
  imports: [DatePipe, MatCardModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Synchronisation</h1>
      <div class="actions">
        <button mat-flat-button type="button" (click)="syncNow()" [disabled]="status.syncing() || !network.online()">
          <mat-icon>sync</mat-icon> {{ status.syncing() ? 'Synchronisation…' : 'Synchroniser maintenant' }}
        </button>
      </div>
    </header>
    <section class="kpis">
      <mat-card appearance="outlined"><mat-card-content><small>Réseau</small>
        <strong>{{ network.online() ? 'En ligne' : 'Hors ligne' }}</strong></mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content><small>Opérations en attente</small>
        <strong>{{ status.pendingCount() }}</strong></mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content><small>Opérations refusées</small>
        <strong [class.error]="status.errorCount() > 0">{{ status.errorCount() }}</strong></mat-card-content></mat-card>
      <mat-card appearance="outlined"><mat-card-content><small>Dernière synchronisation</small>
        <strong>{{ status.lastSyncAt() ? (status.lastSyncAt() | date: 'dd/MM HH:mm') : 'Jamais' }}</strong></mat-card-content></mat-card>
    </section>
    @if (engine.lastError(); as e) {
      <p class="offline-note">{{ e }}</p>
    }
    <mat-card appearance="outlined">
      <mat-card-header><mat-card-title>Données disponibles hors connexion</mat-card-title>
        <mat-card-subtitle>Terminal {{ device()?.code ?? 'non enregistré' }} · curseur {{ cursor() }}
          @if (serverVersion() !== null) { / serveur {{ serverVersion() }} }</mat-card-subtitle></mat-card-header>
      <mat-card-content>
        <ul class="tables">
          @for (entry of counts(); track entry.name) {
            <li><span>{{ entry.label }}</span><strong>{{ entry.count }}</strong></li>
          }
        </ul>
        <button mat-stroked-button type="button" (click)="reset()" [disabled]="!network.online()">
          <mat-icon>restart_alt</mat-icon> Recharger toutes les données
        </button>
        <p class="muted">Les opérations en attente sont conservées lors du rechargement.</p>
      </mat-card-content>
    </mat-card>
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
    .error {
      color: var(--mat-sys-error);
    }
    .tables {
      columns: 2 260px;
      padding: 0;
      list-style: none;
    }
    .tables li {
      display: flex;
      justify-content: space-between;
      padding: 4px 8px;
      break-inside: avoid;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
  `,
})
export class SyncStatePage {
  protected readonly engine = inject(SyncEngineService);
  protected readonly status = inject(SyncStatusService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly device = inject(DeviceService).device;
  private readonly local = inject(LocalDbService);
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);

  protected readonly counts = signal<{ name: string; label: string; count: number }[]>([]);
  protected readonly cursor = signal(0);
  protected readonly serverVersion = signal<number | null>(null);

  constructor() {
    void this.refresh();
  }

  protected async syncNow(): Promise<void> {
    await this.engine.syncNow();
    await this.refresh();
    this.snack.open(this.engine.lastError() ?? 'Synchronisation terminée.');
  }

  protected async reset(): Promise<void> {
    if (!confirm('Recharger toutes les données du serveur sur ce terminal ?')) {
      return;
    }
    await this.local.resetMirrors();
    await this.syncNow();
  }

  private async refresh(): Promise<void> {
    const counts = await this.local.counts();
    this.counts.set(Object.entries(counts).map(([name, count]) => ({ name, label: TABLE_LABELS[name] ?? name, count })));
    this.cursor.set(await this.local.getMeta<number>('cursor', 0));
    if (this.network.online() && this.auth.hasPermission('sync.view')) {
      this.http.get<{ server_version: number }>(`${this.api}/sync/state/`).subscribe({
        next: (state) => this.serverVersion.set(state.server_version),
        error: () => undefined,
      });
    }
  }
}
