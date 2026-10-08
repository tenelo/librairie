import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import {
  ARTICLE_TYPE_LABELS,
  Article,
  ArticleType,
  AuthService,
  CatalogApiService,
  Category,
  FcfaPipe,
  apiErrorMessage,
} from '@librairie/shared';

@Component({
  selector: 'bo-articles-page',
  imports: [
    FormsModule,
    RouterLink,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatProgressBarModule,
    FcfaPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Articles</h1>
      @if (canManage) {
        <a mat-flat-button routerLink="nouveau"><mat-icon>add</mat-icon> Nouvel article</a>
      }
    </header>

    <div class="filters">
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-label>Rechercher ou scanner</mat-label>
        <mat-icon matPrefix>qr_code_scanner</mat-icon>
        <input matInput [(ngModel)]="search" (keyup.enter)="onEnter()" placeholder="Nom, code, code-barres, marque" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Type</mat-label>
        <mat-select [(ngModel)]="type" (selectionChange)="reload(0)">
          <mat-option value="">Tous (hors kits)</mat-option>
          @for (t of types; track t) {
            <mat-option [value]="t">{{ typeLabels[t] }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Catégorie</mat-label>
        <mat-select [(ngModel)]="category" (selectionChange)="reload(0)">
          <mat-option value="">Toutes</mat-option>
          @for (c of categories(); track c.id) {
            <mat-option [value]="c.id">{{ c.path }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Statut</mat-label>
        <mat-select [(ngModel)]="active" (selectionChange)="reload(0)">
          <mat-option value="true">Actifs</mat-option>
          <mat-option value="false">Inactifs</mat-option>
          <mat-option value="">Tous</mat-option>
        </mat-select>
      </mat-form-field>
    </div>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="table-wrapper">
      <table mat-table [dataSource]="articles()">
        <ng-container matColumnDef="code">
          <th mat-header-cell *matHeaderCellDef>Code</th>
          <td mat-cell *matCellDef="let a"><code>{{ a.code }}</code></td>
        </ng-container>
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Désignation</th>
          <td mat-cell *matCellDef="let a">
            <strong>{{ a.name }}</strong>
            @if (a.brand_name) {
              <small> · {{ a.brand_name }}</small>
            }
            <br /><small class="muted">{{ a.category_path || 'Sans catégorie' }}</small>
          </td>
        </ng-container>
        <ng-container matColumnDef="type">
          <th mat-header-cell *matHeaderCellDef>Type</th>
          <td mat-cell *matCellDef="let a">{{ a.type_label }}</td>
        </ng-container>
        <ng-container matColumnDef="price">
          <th mat-header-cell *matHeaderCellDef class="num">Prix détail</th>
          <td mat-cell *matCellDef="let a" class="num">
            {{ a.retail_price | fcfa }}
            @if (a.wholesale_price) {
              <br /><small class="muted">gros {{ a.wholesale_price | fcfa }} dès {{ a.wholesale_min_qty }}</small>
            }
          </td>
        </ng-container>
        <ng-container matColumnDef="barcode">
          <th mat-header-cell *matHeaderCellDef>Code-barres</th>
          <td mat-cell *matCellDef="let a"><code>{{ a.barcodes[0]?.code ?? '—' }}</code></td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Statut</th>
          <td mat-cell *matCellDef="let a">
            <mat-chip-set>
              @if (!a.is_active) {
                <mat-chip>Inactif</mat-chip>
              }
              @if (a.is_online) {
                <mat-chip highlighted>En ligne</mat-chip>
              }
            </mat-chip-set>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="clickable" (click)="open(row)"
            [class.inactive]="!row.is_active"></tr>
        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty" [attr.colspan]="columns.length">Aucun article.</td>
        </tr>
      </table>
    </div>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="pageSize" [hidePageSize]="true"
                   (page)="onPage($event)" />
  `,
  styleUrl: './catalog-page.scss',
})
export class ArticlesPage {
  private readonly api = inject(CatalogApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly canManage = inject(AuthService).hasPermission('catalog.manage');

  protected readonly typeLabels = ARTICLE_TYPE_LABELS;
  protected readonly types: ArticleType[] = ['SIMPLE', 'LOT', 'SERVICE'];
  protected readonly columns = ['code', 'name', 'type', 'price', 'barcode', 'status'];
  protected readonly pageSize = 50;
  protected readonly articles = signal<Article[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly loading = signal(false);
  protected search = '';
  protected type = '';
  protected category = '';
  protected active = 'true';

  constructor() {
    this.api.listCategories().subscribe((categories) => this.categories.set(categories));
    this.reload(0);
  }

  reload(page: number): void {
    this.page.set(page);
    this.loading.set(true);
    this.api
      .listArticles({
        page: page + 1,
        page_size: this.pageSize,
        search: this.search.trim(),
        type: this.type ? [this.type] : this.types,
        category: this.category,
        is_active: this.active,
      })
      .subscribe({
        next: (result) => {
          this.articles.set(result.results);
          this.total.set(result.count);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
        },
      });
  }

  /** Une douchette tape le code puis « Entrée » : ouverture directe de la fiche. */
  protected onEnter(): void {
    const code = this.search.trim();
    if (/^\d{8,14}$/.test(code)) {
      this.api.articleByBarcode(code).subscribe({
        next: (article) => this.open(article),
        error: () => this.reload(0),
      });
      return;
    }
    this.reload(0);
  }

  protected onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }

  protected open(article: Article): void {
    if (article.type === 'KIT' && article.kit_id) {
      void this.router.navigate(['/catalogue/kits', article.kit_id]);
    } else {
      void this.router.navigate(['/catalogue/articles', article.id]);
    }
  }
}
