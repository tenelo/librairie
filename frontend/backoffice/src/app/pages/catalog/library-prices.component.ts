import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  ArticleLibraryPrice,
  AuthService,
  FcfaPipe,
  NetworkStatusService,
  StockApiService,
  apiErrorMessage,
} from '@librairie/shared';

import { LibraryScopeService } from '../../services/library-scope.service';

interface PriceRow {
  library: string;
  libraryName: string;
  /** Prix propre enregistré (absent = prix du catalogue). */
  saved: ArticleLibraryPrice | null;
  /** Saisie en cours (vide = prix du catalogue). */
  draft: number | null;
  editable: boolean;
}

/**
 * Prix par librairie d'un article (fiche article).
 * Le prix du catalogue s'applique partout ; une librairie autorisée peut le remplacer pour ses ventes.
 */
@Component({
  selector: 'bo-library-prices',
  imports: [FormsModule, MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>Prix par librairie</mat-card-title>
          <mat-card-subtitle>
            Prix du catalogue : {{ catalogPrice() | fcfa }}. Une librairie peut appliquer son propre prix de vente ;
            laissez vide pour garder le prix du catalogue.
          </mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <table class="list">
            <thead><tr><th>Librairie</th><th class="num">Prix appliqué</th><th>Prix propre (FCFA)</th><th></th></tr></thead>
            <tbody>
              @for (row of rows(); track row.library) {
                <tr>
                  <td>{{ row.libraryName }}</td>
                  <td class="num">
                    {{ (row.saved?.retail_price ?? catalogPrice()) | fcfa }}
                    @if (!row.saved) { <small class="muted">(catalogue)</small> }
                  </td>
                  <td>
                    @if (row.editable) {
                      <input type="number" min="0" step="5" [ngModel]="row.draft" (ngModelChange)="row.draft = $event"
                             placeholder="Prix du catalogue" [attr.aria-label]="'Prix propre ' + row.libraryName"
                             [disabled]="!network.online()" />
                    } @else {
                      {{ row.saved ? (row.saved.retail_price | fcfa) : '—' }}
                    }
                  </td>
                  <td class="actions">
                    @if (row.editable) {
                      <button mat-stroked-button type="button" (click)="save(row)"
                              [disabled]="busy() || !network.online() || !changed(row)">Enregistrer</button>
                      @if (row.saved) {
                        <button mat-icon-button type="button" (click)="reset(row)" [disabled]="busy() || !network.online()"
                                matTooltip="Revenir au prix du catalogue" aria-label="Revenir au prix du catalogue">
                          <mat-icon>restart_alt</mat-icon>
                        </button>
                      }
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
          @if (!network.online()) {
            <p class="muted"><mat-icon inline>cloud_off</mat-icon> Les prix ne sont modifiables qu'en ligne.</p>
          }
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: `
    mat-card {
      margin-bottom: 16px;
    }
    .list {
      width: 100%;
      border-collapse: collapse;
    }
    .list th,
    .list td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .num {
      text-align: right !important;
      white-space: nowrap;
    }
    input {
      font: inherit;
      padding: 6px;
      width: 140px;
    }
    .actions {
      white-space: nowrap;
      text-align: right;
    }
    .muted {
      opacity: 0.7;
    }
  `,
})
export class LibraryPricesComponent {
  readonly articleId = input.required<string>();
  readonly catalogPrice = input.required<number>();

  private readonly api = inject(StockApiService);
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);
  private readonly scope = inject(LibraryScopeService);
  protected readonly network = inject(NetworkStatusService);

  private readonly prices = signal<ArticleLibraryPrice[]>([]);
  protected readonly busy = signal(false);

  /** Une ligne par librairie visible ; modifiable selon les droits (sa librairie, ou toutes pour l'administrateur). */
  protected readonly rows = computed<PriceRow[]>(() => {
    const saved = new Map(this.prices().map((p) => [p.library, p]));
    const seesAll = this.scope.seesAll();
    const own = this.scope.myLibrary()?.id ?? null;
    const canOwn = this.auth.hasPermission('catalog.library_prices');
    const canAll = seesAll && (canOwn || this.auth.hasPermission('catalog.prices'));
    return this.scope.libraries()
      .filter((l) => l.is_active && (seesAll || l.id === own || saved.has(l.id)))
      .map((l) => {
        const price = saved.get(l.id) ?? null;
        return {
          library: l.id, libraryName: l.name, saved: price, draft: price?.retail_price ?? null,
          editable: canAll || (canOwn && l.id === own),
        };
      });
  });

  constructor() {
    this.scope.load();
    effect(() => {
      const article = this.articleId();
      if (article) {
        this.load(article);
      }
    });
  }

  protected changed(row: PriceRow): boolean {
    return (row.draft ?? null) !== (row.saved?.retail_price ?? null);
  }

  protected save(row: PriceRow): void {
    if (row.draft === null || row.draft === undefined || String(row.draft) === '') {
      this.reset(row);
      return;
    }
    const value = Math.max(0, Math.round(Number(row.draft)));
    this.busy.set(true);
    this.api.saveLibraryPrice({ id: row.saved?.id, article: this.articleId(), library: row.library,
      retail_price: value, wholesale_price: row.saved?.wholesale_price ?? null }).subscribe({
      next: () => this.done(`Prix de ${row.libraryName} enregistré.`),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected reset(row: PriceRow): void {
    if (!row.saved?.id) {
      return;
    }
    this.busy.set(true);
    this.api.deleteLibraryPrice(row.saved.id).subscribe({
      next: () => this.done(`${row.libraryName} revient au prix du catalogue.`),
      error: (err: unknown) => this.fail(err),
    });
  }

  private done(message: string): void {
    this.busy.set(false);
    this.snack.open(message);
    this.load(this.articleId());
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
  }

  private load(article: string): void {
    this.api.listLibraryPrices({ article }).subscribe({
      next: (prices) => this.prices.set(prices),
      error: () => this.prices.set([]),
    });
  }
}
