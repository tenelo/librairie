import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FcfaPipe } from '@librairie/shared';

import { TONTINE_LABEL } from '../../features';

import { TontineSummary, TontinesApiService } from './tontines-api.service';

/** Tableau de bord : souscriptions en cours (souscripteurs, montant attendu, versements reçus). */
@Component({
  selector: 'bo-tontine-kpis',
  imports: [RouterLink, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (summary(); as s) {
      <div class="head">
        <h2>{{ label }}</h2>
        <a routerLink="/tontine-scolaire/souscriptions">Voir les souscriptions</a>
      </div>
      <div class="kpis">
        <div><span>Souscripteurs</span><strong>{{ s.subscribers_count }}</strong></div>
        <div><span>Montant total attendu</span><strong>{{ s.expected_total | fcfa }}</strong></div>
        <div><span>Versements reçus</span><strong>{{ s.received_total | fcfa }}</strong></div>
      </div>
    }
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
  `,
})
export class TontineKpisComponent {
  protected readonly label = TONTINE_LABEL;
  protected readonly summary = signal<TontineSummary | null>(null);

  constructor() {
    // Souscriptions en cours, limitées à sa librairie sauf pour l'administrateur et les personnes désignées.
    inject(TontinesApiService).summary({ status: 'OPEN' }).subscribe({
      next: (summary) => this.summary.set(summary),
      error: () => this.summary.set(null),
    });
  }
}
