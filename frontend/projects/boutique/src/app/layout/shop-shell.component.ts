import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, NetworkIndicatorComponent } from '@librairie/shared';

import { CartService } from '../services/cart.service';
import { ShopInfoService } from '../services/shop-info.service';

@Component({
  selector: 'bt-shop-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatMenuModule,
    NetworkIndicatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-toolbar class="toolbar">
      <a routerLink="/" class="brand">
        <mat-icon>auto_stories</mat-icon>
        <span>{{ shop.info()?.name ?? 'Librairie' }}</span>
      </a>
      <nav class="links">
        <a mat-button routerLink="/catalogue" routerLinkActive="active">Catalogue</a>
        <a mat-button routerLink="/kits" routerLinkActive="active">Kits scolaires</a>
        @if (auth.isAuthenticated()) { <a mat-button routerLink="/mes-commandes" routerLinkActive="active">Mes commandes</a> }
      </nav>
      <span class="spacer"></span>
      <lib-network-indicator [showSync]="false" />
      <a mat-icon-button routerLink="/panier" aria-label="Mon panier">
        <mat-icon [matBadge]="cart.count() || null" matBadgeColor="accent" matBadgeSize="small" aria-hidden="false">shopping_cart</mat-icon>
      </a>
      <button mat-icon-button class="mobile-menu" [matMenuTriggerFor]="menu" aria-label="Menu"><mat-icon>menu</mat-icon></button>
      <mat-menu #menu="matMenu">
        <a mat-menu-item routerLink="/catalogue">Catalogue</a>
        <a mat-menu-item routerLink="/kits">Kits scolaires</a>
        @if (auth.isAuthenticated()) { <a mat-menu-item routerLink="/mes-commandes">Mes commandes</a> }
      </mat-menu>
      @if (auth.isAuthenticated()) {
        <a mat-button routerLink="/mon-compte"><mat-icon>account_circle</mat-icon> <span class="label">Mon compte</span></a>
      } @else {
        <a mat-flat-button routerLink="/connexion">Se connecter</a>
      }
    </mat-toolbar>
    <main class="page"><router-outlet /></main>
    <footer class="footer">
      @if (shop.info(); as info) {
        <span>{{ info.name }} · {{ info.address }} {{ info.city }}</span>
        @if (info.phone) {
          <span>· {{ info.phone }}</span>
        }
      }
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
    }
    .toolbar {
      gap: 8px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: inherit;
      text-decoration: none;
      font-weight: 600;
    }
    .spacer {
      flex: 1;
    }
    .active {
      text-decoration: underline;
    }
    .page {
      flex: 1;
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 16px;
      box-sizing: border-box;
    }
    .footer {
      padding: 16px;
      text-align: center;
      font-size: 13px;
      opacity: 0.75;
    }
    .mobile-menu {
      display: none;
    }
    @media (max-width: 599px) {
      .links,
      .label {
        display: none;
      }
      .mobile-menu {
        display: inline-flex;
      }
    }
  `,
})
export class ShopShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly shop = inject(ShopInfoService);
  protected readonly cart = inject(CartService);

  constructor() {
    this.shop.load();
  }
}
