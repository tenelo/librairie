import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { AuthService, FcfaPipe, apiErrorMessage, saveBlob } from '@librairie/shared';

import { InventoryApiService, InventorySession, InventorySummary, VarianceLine } from './inventory-api.service';

export type VarianceFilter = 'all' | 'variance' | 'uncounted' | 'recount';

/** Filtre des lignes du rapport d'écarts (exporté pour les tests). */
export function filterVarianceLines(lines: VarianceLine[], filter: VarianceFilter, term = ''): VarianceLine[] {
  const needle = term.trim().toLowerCase();
  return lines.filter((line) => {
    if (needle && !`${line.code} ${line.name}`.toLowerCase().includes(needle)) {
      return false;
    }
    switch (filter) {
      case 'variance': return line.variance !== null && line.variance !== 0;
      case 'uncounted': return line.counted === null;
      case 'recount': return line.needs_recount;
      default: return true;
    }
  });
}

/** Suivi d'un inventaire : avancement, rapport d'écarts, revue, validation (ajustements) et exports. */
@Component({
  selector: 'bo-inventory-detail-page',
  imports: [DatePipe, FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session(); as s) {
      <header class="page-header">
        <h1>{{ s.number }} · {{ s.name }}</h1>
        <a mat-button routerLink="/inventaires/en-cours"><mat-icon>arrow_back</mat-icon> Inventaires</a>
      </header>
      <p class="muted">{{ s.kind_label }} · dépôt {{ s.depot_name }} · {{ s.status_label }}
        @if (s.frozen_at) { · stock gelé le {{ s.frozen_at | date: 'dd/MM/yyyy HH:mm' }} }
        @if (s.validated_at) { · validé le {{ s.validated_at | date: 'dd/MM/yyyy HH:mm' }} par {{ s.validated_by_name }} }
        · mode {{ s.counting_mode === 'DOUBLE' ? 'double comptage au-delà de ' + s.double_count_threshold + ' unités' : 'comptages additionnés' }}</p>
      @if (s.assignments.length) {
        <p>Inventoristes : @for (a of s.assignments; track a.user) { <span class="chip">{{ a.user_name || a.user }}@if (a.zone) { ({{ a.zone }}) }</span> }</p>
      }

      @if (summary(); as sum) {
        <div class="kpis">
          <div><span>Articles</span><strong>{{ sum.articles }}</strong></div>
          <div><span>Comptés</span><strong>{{ sum.counted }}</strong></div>
          <div><span>À recompter</span><strong>{{ sum.to_recount }}</strong></div>
          <div><span>Écarts cumulés (unités)</span><strong>{{ sum.variance_units }}</strong></div>
          <div><span>Écart valorisé</span><strong [class.error]="sum.variance_value < 0">{{ sum.variance_value | fcfa }}</strong></div>
        </div>
      }

      <div class="toolbar">
        @switch (s.status) {
          @case ('DRAFT') {
            @if (canManage) {
              <button mat-flat-button (click)="act('start')" [disabled]="busy()"><mat-icon>ac_unit</mat-icon> Geler le stock et démarrer</button>
              <button mat-button (click)="act('cancel')" [disabled]="busy()">Annuler l'inventaire</button>
            }
          }
          @case ('COUNTING') {
            <a mat-stroked-button routerLink="/inventaires/mes-comptages" [queryParams]="{ session: s.id }"><mat-icon>qr_code_scanner</mat-icon> Compter</a>
            @if (canManage) {
              <button mat-flat-button (click)="act('review')" [disabled]="busy()">Terminer les comptages (revue)</button>
              <button mat-button (click)="act('cancel')" [disabled]="busy()">Annuler</button>
            }
          }
          @case ('REVIEW') {
            <a mat-stroked-button routerLink="/inventaires/mes-comptages" [queryParams]="{ session: s.id }">Recompter</a>
            @if (canValidate) {
              <mat-checkbox [(ngModel)]="uncountedAsZero">Articles non comptés à zéro</mat-checkbox>
              <button mat-flat-button (click)="validate()" [disabled]="busy()"><mat-icon>verified</mat-icon> Valider et ajuster le stock</button>
            }
          }
          @case ('VALIDATED') {
            @if (canValidate) { <button mat-flat-button (click)="act('close')" [disabled]="busy()">Clôturer</button> }
          }
        }
        @if (s.status !== 'DRAFT') {
          <button mat-button (click)="download('export')"><mat-icon>table_view</mat-icon> Excel</button>
          <button mat-button (click)="download('pdf')"><mat-icon>picture_as_pdf</mat-icon> PDF</button>
          <button mat-button (click)="load()"><mat-icon>refresh</mat-icon> Actualiser</button>
        }
      </div>

      @if (s.status !== 'DRAFT') {
        <div class="toolbar">
          <input type="search" placeholder="Filtrer (code, libellé)" aria-label="Filtrer les lignes" [ngModel]="term()" (ngModelChange)="term.set($event)" />
          <select aria-label="Lignes affichées" [ngModel]="filter()" (ngModelChange)="filter.set($event)">
            <option value="all">Toutes les lignes</option>
            <option value="variance">Avec écart</option>
            <option value="uncounted">Non comptées</option>
            <option value="recount">À recompter</option>
          </select>
        </div>
        <table class="list">
          <thead><tr><th>Article</th><th class="num">Théorique (gel)</th><th class="num">Mvts pendant</th><th class="num">Attendu</th>
            <th class="num">Compté</th><th class="num">Écart</th><th class="num">Valeur</th></tr></thead>
          <tbody>
            @for (l of visible(); track l.article) {
              <tr [class.warn]="l.needs_recount">
                <td>{{ l.name }} <small class="muted">{{ l.code }}</small>
                  @if (l.needs_recount) { <br /><small class="error">Second comptage requis (1er : {{ l.first_count }})</small> }
                  @if (l.second_count !== null) { <br /><small class="muted">1er : {{ l.first_count }} · 2e : {{ l.second_count }}</small> }
                </td>
                <td class="num">{{ l.theoretical }}</td>
                <td class="num">{{ l.movements_during }}</td>
                <td class="num">{{ l.expected }}</td>
                <td class="num">{{ l.counted ?? '—' }}</td>
                <td class="num" [class.error]="(l.variance ?? 0) < 0">{{ l.variance ?? '—' }}</td>
                <td class="num">{{ l.variance_value | fcfa }}</td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="empty">Aucune ligne.</td></tr>
            }
          </tbody>
        </table>
      }
    } @else {
      <p>Chargement…</p>
    }
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `.chip { display: inline-block; padding: 2px 8px; margin-right: 4px; border-radius: 12px; background: var(--mat-sys-surface-container-high); }
    tr.warn td { background: color-mix(in srgb, var(--mat-sys-error) 8%, transparent); }`,
})
export class InventoryDetailPage implements OnInit {
  private readonly api = inject(InventoryApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);
  protected readonly canManage = this.auth.hasPermission('inventory.create');
  protected readonly canValidate = this.auth.hasPermission('inventory.validate');

  readonly id = input.required<string>();
  protected readonly session = signal<InventorySession | null>(null);
  protected readonly lines = signal<VarianceLine[]>([]);
  protected readonly summary = signal<InventorySummary | null>(null);
  protected readonly busy = signal(false);
  protected readonly filter = signal<VarianceFilter>('all');
  protected readonly term = signal('');
  protected readonly visible = computed(() => filterVarianceLines(this.lines(), this.filter(), this.term()));
  protected uncountedAsZero = false;

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.api.get(this.id()).subscribe({
      next: (session) => {
        this.session.set(session);
        if (session.status !== 'DRAFT') {
          this.api.report(session.id).subscribe((report) => {
            this.lines.set(report.lines);
            this.summary.set(report.summary);
          });
        }
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
    });
  }

  protected act(name: 'start' | 'review' | 'close' | 'cancel'): void {
    if (name === 'cancel' && !confirm('Annuler cet inventaire ? Les comptages saisis seront ignorés.')) {
      return;
    }
    this.run(this.api.action(this.id(), name));
  }

  protected validate(): void {
    const toRecount = this.summary()?.to_recount ?? 0;
    if (toRecount > 0) {
      this.snack.open(`${toRecount} article(s) doivent être recomptés avant la validation.`, 'Fermer');
      return;
    }
    if (!confirm('Valider l\'inventaire ? Des mouvements d\'ajustement seront créés pour chaque écart.')) {
      return;
    }
    this.run(this.api.validate(this.id(), this.uncountedAsZero), 'Inventaire validé : stock ajusté.');
  }

  protected download(kind: 'export' | 'pdf'): void {
    const number = this.session()?.number ?? 'inventaire';
    this.api.file(this.id(), kind).subscribe({
      next: (blob) => saveBlob(blob, `ecarts-${number}.${kind === 'pdf' ? 'pdf' : 'xlsx'}`),
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 }),
    });
  }

  private run(request: ReturnType<InventoryApiService['action']>, message?: string): void {
    this.busy.set(true);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        if (message) {
          this.snack.open(message);
        }
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
      },
    });
  }
}
