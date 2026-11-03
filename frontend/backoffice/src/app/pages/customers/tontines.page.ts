import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import {
  AuthService,
  CatalogApiService,
  FcfaPipe,
  SchoolYear,
  SimpleChartComponent,
  apiErrorMessage,
  saveBlob,
} from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

import { TONTINE_LABEL } from '../../features';
import { LibraryScopeService } from '../../services/library-scope.service';

import { TontineDialogComponent } from './tontine-dialog.component';
import { TontinePieComponent } from './tontine-pie.component';
import { Tontine, TontineFilters, TontineSummary, TontinesApiService } from './tontines-api.service';

/** Résumé court d'une souscription : « 2 × Kit 5ème, 3 × Français 3ème… ». */
export function subscriptionSummary(tontine: Pick<Tontine, 'lines'>, max = 3): string {
  const parts = tontine.lines.map((l) => `${l.quantity} × ${l.description}`);
  return parts.length > max ? `${parts.slice(0, max).join(', ')}…` : parts.join(', ');
}

/**
 * Clients › Tontine scolaire : recherche par nom ou numéro du souscripteur, et où il en est
 * de ses versements (versé, reste, pourcentage).
 */
@Component({
  selector: 'bo-tontines-page',
  imports: [FormsModule, MatButtonModule, MatIconModule, MatPaginatorModule, MatProgressBarModule, FcfaPipe,
    SimpleChartComponent,
    TontinePieComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <h1>{{ label }}</h1>
      <div class="header-actions">
        <button mat-stroked-button type="button" (click)="download()" [disabled]="downloading()"
                title="Kits et articles souscrits, stock et quantités à commander (filtres appliqués)">
          <mat-icon>download</mat-icon> Télécharger Excel
        </button>
        @if (canManage) {
          <button mat-flat-button type="button" (click)="create()"><mat-icon>add</mat-icon> Nouvelle {{ label.toLowerCase() }}</button>
        }
      </div>
    </div>

    @if (summary(); as s) {
      <div class="kpis">
        <div><span>Souscripteurs</span><strong>{{ s.subscribers_count }}</strong>
          <small class="muted">{{ s.subscriptions_count }} souscription(s)</small></div>
        <div><span>Montant total attendu</span><strong>{{ s.expected_total | fcfa }}</strong></div>
        <div><span>Montant reçu</span><strong>{{ s.received_total | fcfa }}</strong>
          <small class="muted">{{ percent(s) }} % · reste {{ s.expected_total - s.received_total | fcfa }}</small></div>
      </div>
      <div class="charts">
        <div class="card">
          <h2>Kits souscrits</h2>
          @if (s.kits.length) {
            <lib-simple-chart [rows]="kitRows(s)" x="label" y="value" type="bar" kind="int" label="Kits souscrits (nombre)"
                              [tiltLabels]="true" [fitWidth]="true" [hint]="false" />
          } @else {
            <p class="muted">Aucun kit dans ces souscriptions.</p>
          }
        </div>
        <div class="card">
          <bo-tontine-pie [expected]="s.expected_total" [received]="s.received_total" />
        </div>
      </div>
    }

    <div class="toolbar">
      <input type="search" [(ngModel)]="search" (input)="load(0)" placeholder="Nom ou numéro du souscripteur"
             aria-label="Rechercher par nom ou numéro" class="wide" />
      <select [(ngModel)]="schoolYear" (change)="load(0)" aria-label="Filtrer par année scolaire">
        @for (y of years(); track y.id) { <option [value]="y.id">{{ y.label }}</option> }
        <option value="">Toutes les années</option>
      </select>
      <select [(ngModel)]="status" (change)="load(0)" aria-label="Filtrer par statut">
        <option value="OPEN">En cours</option>
        <option value="DELIVERED">Fournitures remises</option>
        <option value="CANCELLED">Annulées</option>
        <option value="">Toutes</option>
      </select>
    </div>

    <div class="card table-card">
      <div class="scroll">
      <table class="list">
        <thead>
          <tr><th>Souscripteur</th><th>Souscription</th><th>Où il en est</th><th class="num">Reste</th><th>Statut</th></tr>
        </thead>
        <tbody>
          @for (t of tontines(); track t.id) {
            <tr class="clickable" (click)="open(t)">
              <td><strong>{{ t.subscriber_name }}</strong><br /><small class="muted">{{ t.subscriber_phone || '—' }} · {{ t.number }} · {{ t.school_year_label ?? '—' }}@if (showLibrary) { · {{ t.library_name ?? 'Entrepôt général' }} }</small></td>
              <td>{{ describe(t) }}</td>
              <td class="progress">
                <small>{{ t.paid_amount | fcfa }} / {{ t.target_amount | fcfa }} · {{ t.progress }} %</small>
                <mat-progress-bar mode="determinate" [value]="t.progress" />
              </td>
              <td class="num">{{ t.remaining | fcfa }}</td>
              <td>
                <span class="badge" [class.settled]="t.status === 'OPEN' && !t.remaining" [class.done]="t.status === 'DELIVERED'"
                      [class.cancelled]="t.status === 'CANCELLED'">
                  {{ t.status === 'OPEN' && !t.remaining ? 'Soldée — à retirer' : t.status_label }}
                </span>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">Aucune souscription trouvée.</td></tr>
          }
        </tbody>
      </table>
      </div>
      <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="pageSize()" [pageSizeOptions]="pageSizes"
                     (page)="onPage($event)" aria-label="Pages des souscriptions" />
    </div>
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .wide { flex: 1; min-width: 220px; }
    .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .kpis small { margin-top: 2px; }
    /* Graphique des kits (le plus large) et camembert à sa droite, même hauteur. */
    .charts { display: grid; grid-template-columns: minmax(0, 2.4fr) minmax(220px, 1fr); gap: 16px; align-items: stretch; }
    .charts .card { display: flex; flex-direction: column; margin-bottom: 16px; }
    .charts lib-simple-chart, .charts bo-tontine-pie { flex: 1; }
    @media (max-width: 800px) { .charts { grid-template-columns: 1fr; } }
    h2 { margin-top: 0; font-size: 18px; }
    .progress { min-width: 180px; }
    /* Liste longue : défilement dans le tableau (en-tête fixe), pagination en dessous. */
    .table-card { padding-bottom: 0; }
    .scroll { max-height: 560px; overflow-y: auto; }
    .scroll thead th { position: sticky; top: 0; z-index: 1; background: var(--mat-sys-surface); }
    mat-paginator { background: transparent; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: 12px; white-space: nowrap;
      background: var(--mat-sys-surface-container-high); }
    .badge.settled { background: #2e7d32; color: #fff; }
    .badge.done { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .badge.cancelled { opacity: 0.6; }
  `,
})
export class TontinesPage {
  private readonly api = inject(TontinesApiService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly canManage = inject(AuthService).hasPermission('tontines.manage');
  protected readonly label = TONTINE_LABEL;
  /** Plusieurs librairies visibles : la librairie de chaque souscription est indiquée. */
  protected readonly showLibrary = inject(LibraryScopeService).seesAll()
    || inject(AuthService).hasPermission('tontines.view_all');
  protected readonly describe = subscriptionSummary;
  protected readonly summary = signal<TontineSummary | null>(null);

  protected readonly tontines = signal<Tontine[]>([]);
  /** Pagination : 10 souscriptions par page par défaut. */
  protected readonly pageSizes = [10, 25, 50];
  protected readonly pageSize = signal(10);
  protected readonly page = signal(0);
  protected readonly total = signal(0);
  protected search = '';
  protected status = 'OPEN';
  /** Année scolaire affichée : l'année en cours par défaut (bilan par année). */
  protected schoolYear = '';
  protected readonly years = signal<SchoolYear[]>([]);

  constructor() {
    inject(CatalogApiService).listSchoolYears().subscribe({
      next: (years) => {
        this.years.set(years);
        this.schoolYear = years.find((y) => y.is_current)?.id ?? '';
        this.load(0);
      },
      error: () => this.load(0),
    });
  }

  private filters(): TontineFilters {
    return { status: this.status, search: this.search.trim(), school_year: this.schoolYear };
  }

  /** Recharge la liste ; `page` (0 = première) est remis à zéro quand la recherche ou le statut change. */
  protected load(page = this.page()): void {
    this.page.set(page);
    this.api.list(this.filters(), page + 1, this.pageSize()).subscribe({
      next: (result) => {
        this.tontines.set(result.results);
        this.total.set(result.count);
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 }),
    });
    this.api.summary(this.filters()).subscribe((s) => this.summary.set(s));
  }

  protected readonly downloading = signal(false);

  /** Excel des kits et articles souscrits (filtres de la page) : TCD, besoin en articles et stock. */
  protected download(): void {
    this.downloading.set(true);
    this.api.exportExcel(this.filters()).subscribe({
      next: (response) => {
        this.downloading.set(false);
        const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1];
        saveBlob(response.body!, name ?? 'souscriptions.xlsx');
      },
      error: (err: unknown) => {
        this.downloading.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
      },
    });
  }

  protected onPage(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.load(event.pageIndex);
  }

  protected percent(s: TontineSummary): number {
    return s.expected_total ? Math.floor((s.received_total * 100) / s.expected_total) : 0;
  }

  protected kitRows(s: TontineSummary): Record<string, unknown>[] {
    return s.kits.map((k) => ({ label: k.label, value: k.quantity }));
  }

  protected open(tontine: Tontine): void {
    void this.router.navigate(['/tontine-scolaire/souscriptions', tontine.id]);
  }

  protected async create(): Promise<void> {
    const created = await firstValueFrom(this.dialog.open(TontineDialogComponent, { width: '680px', maxWidth: '96vw' })
      .afterClosed()) as Tontine | undefined;
    if (created) {
      // On reste sur la liste, la nouvelle souscription y apparaît.
      this.snack.open(`${created.subscriber_name} : ${created.target_amount} FCFA à verser.`, 'OK', { duration: 6000 });
      this.status = 'OPEN';
      this.search = '';
      this.load(0);
    }
  }
}
