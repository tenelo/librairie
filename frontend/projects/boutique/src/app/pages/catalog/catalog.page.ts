import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { NetworkStatusService, ShopArticle, ShopReference } from '@librairie/shared';
import { Subject, debounceTime } from 'rxjs';

import { ShopApiService } from '../../services/shop-api.service';
import { ArticleCardComponent } from './article-card.component';

/** Catalogue en ligne : recherche, filtre par catégorie, disponibilité, ajout au panier. */
@Component({
  selector: 'bt-catalog-page',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatIconModule,
    ArticleCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Catalogue</h1>
    @if (!network.online()) { <p class="offline">Hors connexion : le catalogue s'affichera au retour du réseau.</p> }
    <div class="filters">
      <mat-form-field class="search">
        <mat-label>Rechercher un article</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input matInput [ngModel]="term()" (ngModelChange)="term.set($event); search$.next()" />
      </mat-form-field>
      <mat-form-field>
        <mat-label>Catégorie</mat-label>
        <mat-select [ngModel]="category()" (ngModelChange)="category.set($event); load(true)">
          <mat-option [value]="null">Toutes les catégories</mat-option>
          @for (c of reference()?.categories ?? []; track c.id) { <mat-option [value]="c.id">{{ c.path }}</mat-option> }
        </mat-select>
      </mat-form-field>
    </div>
    <div class="grid">
      @for (a of articles(); track a.id) { <bt-article-card [article]="a" /> }
      @empty { @if (!loading()) { <p>Aucun article ne correspond à votre recherche.</p> } }
    </div>
    @if (hasMore()) {
      <div class="more"><button mat-stroked-button type="button" (click)="more()" [disabled]="loading()">Voir plus d'articles</button></div>
    }
  `,
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 12px; }
    .search { flex: 1 1 280px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .more { text-align: center; margin: 24px 0; }
    .offline { color: var(--mat-sys-error); }
  `,
})
export class CatalogPage implements OnInit {
  private readonly api = inject(ShopApiService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly reference = signal<ShopReference | null>(null);
  protected readonly articles = signal<ShopArticle[]>([]);
  protected readonly term = signal('');
  protected readonly category = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly search$ = new Subject<void>();
  private page = 1;

  constructor() {
    this.search$.pipe(debounceTime(300)).subscribe(() => this.load(true));
  }

  ngOnInit(): void {
    this.api.reference().subscribe({ next: (ref) => this.reference.set(ref), error: () => undefined });
    this.load(true);
  }

  protected load(reset: boolean): void {
    if (reset) {
      this.page = 1;
    }
    this.loading.set(true);
    this.api.articles({ search: this.term().trim(), category: this.category(), page: this.page }).subscribe({
      next: (page) => {
        this.articles.set(reset ? page.results : [...this.articles(), ...page.results]);
        this.hasMore.set(!!page.next);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected more(): void {
    this.page += 1;
    this.load(false);
  }
}
