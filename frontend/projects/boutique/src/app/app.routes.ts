import { Routes } from '@angular/router';
import { authGuard, guestGuard } from '@librairie/shared';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/shop-shell.component').then((m) => m.ShopShellComponent),
    children: [
      {
        path: '',
        title: 'Accueil · Librairie',
        loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage),
      },
      {
        path: 'catalogue',
        title: 'Catalogue · Librairie',
        loadComponent: () => import('./pages/catalog/catalog.page').then((m) => m.CatalogPage),
      },
      {
        path: 'kits',
        title: 'Kits scolaires · Librairie',
        loadComponent: () => import('./pages/catalog/kits.page').then((m) => m.KitsPage),
      },
      {
        path: 'panier',
        title: 'Mon panier · Librairie',
        loadComponent: () => import('./pages/orders/cart.page').then((m) => m.CartPage),
      },
      {
        path: 'mes-commandes',
        title: 'Mes commandes · Librairie',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/orders/orders.page').then((m) => m.OrdersPage),
      },
      {
        path: 'mes-commandes/:id',
        title: 'Suivi de commande · Librairie',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/orders/order.page').then((m) => m.OrderPage),
      },
      {
        path: 'connexion',
        title: 'Connexion · Librairie',
        canMatch: [guestGuard],
        loadComponent: () => import('./pages/auth/login.page').then((m) => m.ShopLoginPage),
      },
      {
        path: 'inscription',
        title: 'Créer un compte · Librairie',
        canMatch: [guestGuard],
        loadComponent: () => import('./pages/auth/register.page').then((m) => m.RegisterPage),
      },
      {
        path: 'mon-compte',
        title: 'Mon compte · Librairie',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/account/account.page').then((m) => m.AccountPage),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
