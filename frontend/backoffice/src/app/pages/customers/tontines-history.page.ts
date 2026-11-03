import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { CatalogApiService, FcfaPipe, SchoolYear, apiErrorMessage } from '@librairie/shared';

import { TONTINE_LABEL } from '../../features';

import { subscriptionSummary } from './tontines.page';
import { Tontine, TontineFilters, TontineSummary, TontinesApiService } from './tontines-api.service';

/**
 * Clients › Historique des souscriptions (tontine scolaire) : toutes les souscriptions (remises, annulées, en cours), par année
 * scolaire, avec qui a fait quoi et quand. Un clic ouvre la fiche et sa traçabilité complète.
 */
@Component({
  selector: 'bo-tontines-history-page',
  imports: [DatePipe, FormsModule, MatPaginatorModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Historique des souscriptions</h1>
    <p class="muted">{{ label }} : souscriptions remises, annulées et en cours, par année scolaire.</p>

    <div class="toolbar">
      <input type="search" [(ngModel)]="search" (input)="load(0)" placeholder="Nom ou numéro du souscripteur"
             aria-label="Rechercher par nom ou numéro" class="wide" />
      <select [(ngModel)]="schoolYear" (change)="load(0)" aria-label="Filtrer par année scolaire">
        <option value="">Toutes les années</option>
        @for (y of years(); track y.id) { <option [value]="y.id">{{ y.label }}</option> }
      </select>
      <select [(ngModel)]="status" (change)="load(0)" aria-label="Filtrer par statut">
        <option value="">Tous les statuts</option>
        <option value="DELIVERED">Fournitures remises</option>
        <option value="CANCELLED">Annulées</option>
        <option value="OPEN">En cours</option>
      </select>
    </div>

    @if (summary(); as s) {
      <div class="kpis">
        <div><span>Souscriptions</span><strong>{{ s.subscriptions_count }}</strong>
          <small class="muted">{{ s.subscribers_count }} souscripteur(s)</small></div>
        <div><span>Montant souscrit</span><strong>{{ s.expected_total | fcfa }}</strong></div>
        <div><span>Montant versé</span><strong>{{ s.received_total | fcfa }}</strong>
          <small class="muted">annulations remboursées déduites</small></div>
      </div>
    }

    <div class="card table-card">
      <div class="scroll">
        <table class="list">
          <thead>
            <tr><th>Souscripteur</th><th>Année</th><th>Souscription</th><th class="num">Montant</th>
              <th class="num">Versé</th><th>Statut</th><th>Clôture</th></tr>
          </thead>
          <tbody>
            @for (t of tontines(); track t.id) {
              <tr class="clickable" (click)="open(t)">
                <td><strong>{{ t.subscriber_name }}</strong><br />
                  <small class="muted">{{ t.subscriber_phone || '—' }} · {{ t.number }}</small><br />
                  <small class="muted">souscrite le {{ t.created_at | date: 'dd/MM/yyyy' }} par {{ t.created_by_name }}</small></td>
                <td>{{ t.school_year_label ?? '—' }}</td>
                <td>{{ describe(t) }}</td>
                <td class="num">{{ t.target_amount | fcfa }}</td>
                <td class="num">{{ t.paid_amount | fcfa }}</td>
                <td><span class="badge" [class.done]="t.status === 'DELIVERED'" [class.cancelled]="t.status === 'CANCELLED'">
                  {{ t.status_label }}</span></td>
                <td>
                  @if (t.status === 'DELIVERED') {
                    {{ t.delivered_at | date: 'dd/MM/yyyy' }}<br /><small class="muted">par {{ t.delivered_by_name ?? '—' }}
                      @if (t.sale_receipt) { · reçu {{ t.sale_receipt }} }</small>
                  } @else if (t.status === 'CANCELLED') {
                    {{ t.cancelled_at | date: 'dd/MM/yyyy' }}<br /><small class="muted">par {{ t.cancelled_by_name ?? '—' }}
                      @if (t.cancel_reason) { · {{ t.cancel_reason }} }</small>
                  } @else {
                    <small class="muted">—</small>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="empty">Aucune souscription pour ces filtres.</td></tr>
            }
          </tbody>
        </table>
      </div>
      <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="pageSize()" [pageSizeOptions]="[10, 25, 50]"
                     (page)="onPage($event)" aria-label="Pages de l'historique" />
    </div>
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .wide { flex: 1; min-width: 220px; }
    .table-card { padding-bottom: 0; }
    .scroll { max-height: 560px; overflow-y: auto; }
    .scroll thead th { position: sticky; top: 0; z-index: 1; background: var(--mat-sys-surface); }
    mat-paginator { background: transparent; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: 12px; white-space: nowrap;
      background: var(--mat-sys-surface-container-high); }
    .badge.done { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .badge.cancelled { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
  `,
})
export class TontinesHistoryPage {
  private readonly api = inject(TontinesApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly label = TONTINE_LABEL;
  protected readonly describe = subscriptionSummary;

  protected readonly years = signal<SchoolYear[]>([]);
  protected readonly tontines = signal<Tontine[]>([]);
  protected readonly summary = signal<TontineSummary | null>(null);
  protected readonly pageSize = signal(10);
  protected readonly page = signal(0);
  protected readonly total = signal(0);
  protected search = '';
  protected status = '';
  protected schoolYear = '';

  constructor() {
    inject(CatalogApiService).listSchoolYears().subscribe((years) => this.years.set(years));
    this.load(0);
  }

  private filters(): TontineFilters {
    return { status: this.status, search: this.search.trim(), school_year: this.schoolYear };
  }

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

  protected onPage(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.load(event.pageIndex);
  }

  protected open(tontine: Tontine): void {
    void this.router.navigate(['/tontine-scolaire/souscriptions', tontine.id]);
  }
}
