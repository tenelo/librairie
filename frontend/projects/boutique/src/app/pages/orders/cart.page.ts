import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { AuthService, FcfaPipe, NetworkStatusService, ShopReference, apiErrorMessage } from '@librairie/shared';

import { CartService } from '../../services/cart.service';
import { ShopApiService } from '../../services/shop-api.service';
import { ShopInfoService } from '../../services/shop-info.service';

/** Acompte demandé (arrondi au franc supérieur, comme le serveur). */
export function depositAmount(total: number, percent: number): number {
  return percent > 0 ? Math.ceil((total * percent) / 100) : 0;
}

/** Panier et validation de la commande : point de retrait, créneau, commentaire, mode de paiement. */
@Component({
  selector: 'bt-cart-page',
  imports: [FormsModule, RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatCheckboxModule, MatRadioModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mon panier</h1>
    @if (cart.lines().length === 0) {
      <p>Votre panier est vide. <a routerLink="/catalogue">Parcourir le catalogue</a> ou <a routerLink="/kits">choisir un kit scolaire</a>.</p>
    } @else {
      <table class="cart">
        <thead><tr><th>Article</th><th class="num">Prix</th><th class="num">Quantité</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>
          @for (l of cart.lines(); track l.article.id) {
            <tr>
              <td>{{ l.article.name }}</td>
              <td class="num">{{ l.article.price | fcfa }}</td>
              <td class="num"><input type="number" min="1" [max]="l.article.available ?? 99" [ngModel]="l.quantity"
                (ngModelChange)="cart.setQuantity(l.article.id, $event)" [attr.aria-label]="'Quantité ' + l.article.name" /></td>
              <td class="num">{{ l.article.price * l.quantity | fcfa }}</td>
              <td><button mat-icon-button type="button" (click)="cart.remove(l.article.id)" aria-label="Retirer"><mat-icon>delete</mat-icon></button></td>
            </tr>
          }
        </tbody>
        <tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="num"><strong>{{ cart.total() | fcfa }}</strong></td><td></td></tr></tfoot>
      </table>

      <mat-card appearance="outlined" class="checkout">
        <mat-card-content>
          <h2>Retrait en librairie</h2>
          @if ((reference()?.pickup_points?.length ?? 0) > 1) {
            <mat-form-field class="wide"><mat-label>Point de retrait</mat-label>
              <mat-select [(ngModel)]="pickupDepot">
                @for (p of reference()!.pickup_points; track p.id) { <mat-option [value]="p.id">{{ p.name }}@if (p.address) { — {{ p.address }} }</mat-option> }
              </mat-select>
            </mat-form-field>
          } @else if (reference()?.pickup_points?.[0]; as p) {
            <p>Retrait à <strong>{{ p.name }}</strong>@if (p.address) { — {{ p.address }} }</p>
          }
          <mat-form-field><mat-label>Créneau de retrait souhaité</mat-label>
            <input matInput type="datetime-local" [(ngModel)]="slot" [min]="minSlot" />
            <mat-hint>Facultatif. La commande est conservée {{ shop.info()?.order_expiry_hours ?? 72 }} h une fois prête.</mat-hint>
          </mat-form-field>
          <mat-form-field class="wide"><mat-label>Commentaire</mat-label>
            <textarea matInput rows="2" [(ngModel)]="comment" maxlength="1000"></textarea>
          </mat-form-field>
          <mat-checkbox [(ngModel)]="acceptPartial">J'accepte une commande partielle si un article vient à manquer</mat-checkbox>

          <h2>Paiement</h2>
          <mat-radio-group [(ngModel)]="paymentMode" class="modes">
            <mat-radio-button value="ON_PICKUP">Paiement au retrait (espèces, Mobile Money, carte)</mat-radio-button>
            @if (depositPercent() > 0) {
              <mat-radio-button value="DEPOSIT">Acompte Mobile Money de {{ depositPercent() }} % ({{ deposit() | fcfa }}), solde au retrait</mat-radio-button>
            }
          </mat-radio-group>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </mat-card-content>
        <mat-card-actions align="end">
          @if (!auth.isAuthenticated()) {
            <a mat-flat-button [routerLink]="['/connexion']" [queryParams]="{ retour: '/panier' }">Se connecter pour commander</a>
          } @else {
            <button mat-flat-button type="button" (click)="submit()" [disabled]="busy() || !network.online()">
              <mat-icon>check</mat-icon> Valider ma commande ({{ cart.total() | fcfa }})
            </button>
          }
        </mat-card-actions>
      </mat-card>
    }
  `,
  styles: `
    .cart { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .cart th, .cart td { padding: 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); text-align: left; }
    .num { text-align: right !important; white-space: nowrap; }
    .cart input { width: 64px; font: inherit; padding: 4px; text-align: right; }
    .checkout mat-card-content { display: flex; flex-direction: column; gap: 8px; }
    .modes { display: flex; flex-direction: column; gap: 4px; }
    .error { color: var(--mat-sys-error); }
  `,
})
export class CartPage implements OnInit {
  protected readonly cart = inject(CartService);
  protected readonly auth = inject(AuthService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly shop = inject(ShopInfoService);
  private readonly api = inject(ShopApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly reference = signal<ShopReference | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly depositPercent = computed(() => Number(this.shop.info()?.online_deposit_percent ?? 0));
  protected readonly deposit = computed(() => depositAmount(this.cart.total(), this.depositPercent()));
  protected pickupDepot: string | null = null;
  protected slot = '';
  protected comment = '';
  protected acceptPartial = false;
  protected paymentMode: 'ON_PICKUP' | 'DEPOSIT' = 'ON_PICKUP';
  protected readonly minSlot = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  ngOnInit(): void {
    this.api.reference().subscribe({
      next: (ref) => {
        this.reference.set(ref);
        this.pickupDepot = ref.pickup_points[0]?.id ?? null;
      },
      error: () => undefined,
    });
  }

  protected submit(): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.place({
      pickup_depot: this.pickupDepot, pickup_slot: this.slot ? new Date(this.slot).toISOString() : null,
      comment: this.comment.trim(), accept_partial: this.acceptPartial, payment_mode: this.paymentMode,
      lines: this.cart.lines().map((l) => ({ article: l.article.id, quantity: l.quantity })),
    }).subscribe({
      next: (order) => {
        this.busy.set(false);
        this.cart.clear();
        this.snack.open(`Commande ${order.number} enregistrée. Nous vous prévenons dès qu'elle est prête.`);
        void this.router.navigate(['/mes-commandes', order.id]);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
