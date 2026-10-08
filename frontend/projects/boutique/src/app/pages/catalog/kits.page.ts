import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { AVAILABILITY_LABELS, FcfaPipe, ShopKit, ShopReference } from '@librairie/shared';

import { CartService } from '../../services/cart.service';
import { ShopApiService } from '../../services/shop-api.service';

/** Kits scolaires : choix de l'établissement et du niveau, contenu du kit, ajout au panier. */
@Component({
  selector: 'bt-kits-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatCardModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Kits scolaires</h1>
    <p>Choisissez l'établissement et la classe : le kit contient toute la liste de fournitures demandée.</p>
    <div class="filters">
      <mat-form-field>
        <mat-label>Établissement</mat-label>
        <mat-select [ngModel]="school()" (ngModelChange)="school.set($event); load()">
          <mat-option [value]="null">Tous les établissements</mat-option>
          @for (s of reference()?.schools ?? []; track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Niveau</mat-label>
        <mat-select [ngModel]="level()" (ngModelChange)="level.set($event); load()">
          <mat-option [value]="null">Tous les niveaux</mat-option>
          @for (l of reference()?.levels ?? []; track l.id) { <mat-option [value]="l.id">{{ l.label }}</mat-option> }
        </mat-select>
      </mat-form-field>
    </div>
    <div class="kits">
      @for (k of kits(); track k.id) {
        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-icon mat-card-avatar>backpack</mat-icon>
            <mat-card-title>{{ k.article.name }}</mat-card-title>
            <mat-card-subtitle>{{ k.level_label }}@if (k.school_name) { · {{ k.school_name }} }@if (k.school_year_label) { · {{ k.school_year_label }} }</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <ul>
              @for (c of k.components; track $index) {
                <li>{{ c.quantity }} × {{ c.name }}@if (c.is_optional) { <em> (facultatif)</em> }</li>
              }
            </ul>
            <p class="price">{{ k.article.price | fcfa }}
              <span class="availability" [class]="k.article.availability">{{ labels[k.article.availability] }}</span></p>
          </mat-card-content>
          <mat-card-actions>
            <button mat-flat-button type="button" (click)="add(k)" [disabled]="k.article.availability === 'OUT'">
              <mat-icon>add_shopping_cart</mat-icon> Ajouter le kit
            </button>
          </mat-card-actions>
        </mat-card>
      } @empty {
        @if (!loading()) { <p>Aucun kit en ligne pour cette sélection. Contactez la librairie pour une liste spécifique.</p> }
      }
    </div>
  `,
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 12px; }
    .kits { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    ul { padding-left: 18px; margin: 8px 0; columns: 1; }
    .price { font-size: 20px; font-weight: 600; display: flex; gap: 12px; align-items: center; }
    .availability { font-size: 12px; font-weight: normal; padding: 2px 8px; border-radius: 10px; }
    .IN_STOCK { background: #e3f4e5; color: #1b5e20; }
    .LOW { background: #fff3e0; color: #b45309; }
    .OUT { background: #fde8e8; color: #b00020; }
  `,
})
export class KitsPage implements OnInit {
  private readonly api = inject(ShopApiService);
  private readonly cart = inject(CartService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly labels = AVAILABILITY_LABELS;
  protected readonly reference = signal<ShopReference | null>(null);
  protected readonly kits = signal<ShopKit[]>([]);
  protected readonly school = signal<string | null>(null);
  protected readonly level = signal<string | null>(null);
  protected readonly loading = signal(false);

  ngOnInit(): void {
    this.api.reference().subscribe({ next: (ref) => this.reference.set(ref), error: () => undefined });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.api.kits(this.school(), this.level()).subscribe({
      next: (page) => {
        this.kits.set(page.results);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected add(kit: ShopKit): void {
    this.cart.add(kit.article);
    this.snack.open(`${kit.article.name} ajouté au panier.`, 'Voir le panier', { duration: 3000 }).onAction()
      .subscribe(() => void this.router.navigate(['/panier']));
  }
}
