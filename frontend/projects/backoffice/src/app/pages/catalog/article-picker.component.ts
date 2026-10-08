import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ArticleLookup, CatalogApiService, FcfaPipe } from '@librairie/shared';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';

/**
 * Recherche d'article par nom, code ou code-barres. Une saisie de douchette (code suivi
 * de « Entrée ») sélectionne directement l'article correspondant.
 */
@Component({
  selector: 'bo-article-picker',
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="picker" subscriptSizing="dynamic">
      <mat-label>{{ label() }}</mat-label>
      <mat-icon matPrefix>search</mat-icon>
      <input
        matInput
        [ngModel]="term()"
        (ngModelChange)="term.set($event)"
        [matAutocomplete]="auto"
        (keydown.enter)="scan($event)"
        placeholder="Nom, code ou code-barres"
        autocomplete="off"
      />
      <mat-autocomplete #auto="matAutocomplete" (optionSelected)="choose($event)">
        @for (article of results(); track article.id) {
          <mat-option [value]="article">
            <span class="code">{{ article.code }}</span> {{ article.name }}
            <span class="price">{{ article.retail_price | fcfa }}</span>
          </mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: `
    .picker {
      width: 100%;
    }
    .code {
      font-family: monospace;
      opacity: 0.7;
      margin-right: 8px;
    }
    .price {
      float: right;
      opacity: 0.8;
    }
  `,
})
export class ArticlePickerComponent {
  private readonly api = inject(CatalogApiService);

  readonly label = input('Ajouter un article');
  readonly excludeKits = input(true);
  readonly picked = output<ArticleLookup>();

  protected readonly term = signal('');
  protected readonly results = toSignal(
    toObservable(this.term).pipe(
      debounceTime(200),
      distinctUntilChanged(),
      switchMap((term) =>
        typeof term === 'string' && term.trim().length >= 2
          ? this.api.lookupArticles(term.trim(), this.excludeKits()).pipe(catchError(() => of([])))
          : of([]),
      ),
    ),
    { initialValue: [] as ArticleLookup[] },
  );

  protected choose(event: MatAutocompleteSelectedEvent): void {
    this.picked.emit(event.option.value as ArticleLookup);
    this.term.set('');
  }

  /** Lecture d'une douchette : un code-barres exact sélectionne l'article sans passer par la liste. */
  protected scan(event: Event): void {
    const code = this.term().trim();
    if (!/^\d{8,14}$/.test(code)) {
      return;
    }
    event.preventDefault();
    this.api.articleByBarcode(code).subscribe({
      next: (article) => {
        this.picked.emit({
          id: article.id,
          code: article.code,
          name: article.name,
          type: article.type,
          retail_price: article.retail_price,
          avg_cost: article.avg_cost,
          is_active: article.is_active,
          barcode: code,
        });
        this.term.set('');
      },
      error: () => undefined,
    });
  }
}
