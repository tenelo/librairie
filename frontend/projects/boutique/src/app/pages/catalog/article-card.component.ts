import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AVAILABILITY_LABELS, FcfaPipe, ShopArticle } from '@librairie/shared';

import { CartService } from '../../services/cart.service';

/** Carte d'un article du catalogue en ligne : prix, disponibilité, ajout au panier. */
@Component({
  selector: 'bt-article-card',
  imports: [MatCardModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let a = article();
    <mat-card appearance="outlined" class="card">
      <div class="visual">
        @if (a.image) { <img [src]="a.image" [alt]="a.name" loading="lazy" /> }
        @else { <mat-icon aria-hidden="true">{{ a.type === 'KIT' ? 'backpack' : 'menu_book' }}</mat-icon> }
      </div>
      <mat-card-content>
        <h3>{{ a.name }}</h3>
        @if (a.category_path) { <p class="muted">{{ a.category_path }}</p> }
        <p class="price">{{ a.price | fcfa }}</p>
        <span class="availability" [class]="a.availability">{{ labels[a.availability] }}</span>
      </mat-card-content>
      <mat-card-actions>
        <button mat-flat-button type="button" (click)="add()" [disabled]="a.availability === 'OUT'">
          <mat-icon>add_shopping_cart</mat-icon> Ajouter
        </button>
      </mat-card-actions>
    </mat-card>
  `,
  styles: `
    .card { height: 100%; display: flex; flex-direction: column; }
    .visual { height: 140px; display: grid; place-items: center; background: var(--mat-sys-surface-container); }
    .visual img { max-height: 140px; max-width: 100%; object-fit: contain; }
    .visual mat-icon { font-size: 56px; width: 56px; height: 56px; color: var(--mat-sys-primary); }
    mat-card-content { flex: 1; }
    h3 { font-size: 15px; margin: 8px 0 4px; }
    .muted { font-size: 12px; opacity: 0.7; margin: 0; }
    .price { font-size: 18px; font-weight: 600; margin: 6px 0; }
    .availability { font-size: 12px; padding: 2px 8px; border-radius: 10px; }
    .IN_STOCK { background: #e3f4e5; color: #1b5e20; }
    .LOW { background: #fff3e0; color: #b45309; }
    .OUT { background: #fde8e8; color: #b00020; }
  `,
})
export class ArticleCardComponent {
  readonly article = input.required<ShopArticle>();
  private readonly cart = inject(CartService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly labels = AVAILABILITY_LABELS;

  protected add(): void {
    const article = this.article();
    const before = this.cart.lines().find((l) => l.article.id === article.id)?.quantity ?? 0;
    const after = this.cart.add(article);
    const message = after > before ? `${article.name} ajouté au panier.` : 'Quantité maximale disponible atteinte.';
    this.snack.open(message, 'Voir le panier', { duration: 3000 }).onAction()
      .subscribe(() => void this.router.navigate(['/panier']));
  }
}
