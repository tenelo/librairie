import { Route, Routes } from '@angular/router';
import { authGuard, guestGuard, permissionGuard } from '@librairie/shared';

import { MENU, MenuLink, MenuSection, sectionPermissions } from './navigation/menu';

type LazyComponent = Route['loadComponent'];

/** Écrans déjà réalisés, indexés par « section/lien ». Les autres affichent la page de module. */
const IMPLEMENTED: Record<string, LazyComponent> = {
  'audit/journal': () => import('./pages/audit/audit-log.page').then((m) => m.AuditLogPage),
  'audit/connexions': () => import('./pages/audit/audit-log.page').then((m) => m.AuditLogPage),
  'administration/utilisateurs': () => import('./pages/admin/users.page').then((m) => m.UsersPage),
  'administration/roles': () => import('./pages/admin/roles.page').then((m) => m.RolesPage),
  'administration/terminaux': () => import('./pages/admin/devices.page').then((m) => m.DevicesPage),
  'administration/parametres': () =>
    import('./pages/admin/library-settings.page').then((m) => m.LibrarySettingsPage),
  'catalogue/articles': () => import('./pages/catalog/articles.page').then((m) => m.ArticlesPage),
  'catalogue/kits': () => import('./pages/catalog/kits.page').then((m) => m.KitsPage),
  'catalogue/categories': () => import('./pages/catalog/categories.page').then((m) => m.CategoriesPage),
  'catalogue/niveaux': () => import('./pages/catalog/levels-schools.page').then((m) => m.LevelsSchoolsPage),
  'catalogue/etiquettes': () => import('./pages/catalog/labels.page').then((m) => m.LabelsPage),
  'catalogue/import-export': () => import('./pages/catalog/import-export.page').then((m) => m.ImportExportPage),
  'clients/etablissements': () => import('./pages/catalog/levels-schools.page').then((m) => m.LevelsSchoolsPage),
  'stock/etat': () => import('./pages/stock/stock-state.page').then((m) => m.StockStatePage),
  'stock/mouvements': () => import('./pages/stock/movements.page').then((m) => m.MovementsPage),
  'stock/transferts': () => import('./pages/stock/transfers.page').then((m) => m.TransfersPage),
  'stock/assemblage': () => import('./pages/stock/assembly.page').then((m) => m.AssemblyPage),
  'stock/pertes': () => import('./pages/stock/losses.page').then((m) => m.LossesPage),
  'stock/alertes': () => import('./pages/stock/alerts.page').then((m) => m.AlertsPage),
  'achats/fournisseurs': () => import('./pages/purchasing/suppliers.page').then((m) => m.SuppliersPage),
  'achats/bons-de-commande': () => import('./pages/purchasing/orders.page').then((m) => m.OrdersPage),
  'achats/receptions': () => import('./pages/purchasing/receipts.page').then((m) => m.ReceiptsPage),
  'achats/suggestions': () => import('./pages/purchasing/suggestions.page').then((m) => m.SuggestionsPage),
  'synchronisation/etat': () => import('./pages/sync/sync-state.page').then((m) => m.SyncStatePage),
  'synchronisation/file': () => import('./pages/sync/sync-queue.page').then((m) => m.SyncQueuePage),
  'synchronisation/conflits': () => import('./pages/sync/sync-conflicts.page').then((m) => m.SyncConflictsPage),
  'caisse/nouvelle-vente': () => import('./pages/sales/pos.page').then((m) => m.PosPage),
  'caisse/en-attente': () => import('./pages/sales/held.page').then((m) => m.HeldPage),
  'caisse/historique': () => import('./pages/sales/history.page').then((m) => m.HistoryPage),
  'caisse/retours': () => import('./pages/sales/returns.page').then((m) => m.ReturnsPage),
  'caisse/sessions': () => import('./pages/sales/sessions.page').then((m) => m.SessionsPage),
  'caisse/rapports-z': () => import('./pages/sales/z-reports.page').then((m) => m.ZReportsPage),
  'clients/liste': () => import('./pages/customers/customers.page').then((m) => m.CustomersPage),
  'clients/credits': () => import('./pages/customers/credits.page').then((m) => m.CreditsPage),
  'clients/fidelite': () => import('./pages/customers/loyalty.page').then((m) => m.LoyaltyPage),
  'administration/moyens-de-paiement': () =>
    import('./pages/admin/payment-methods.page').then((m) => m.PaymentMethodsPage),
  'administration/depots': () => import('./pages/admin/depots.page').then((m) => m.DepotsPage),
  'commandes/a-confirmer': () => import('./pages/orders/orders.page').then((m) => m.OnlineOrdersPage),
  'commandes/a-preparer': () => import('./pages/orders/orders.page').then((m) => m.OnlineOrdersPage),
  'commandes/pretes': () => import('./pages/orders/orders.page').then((m) => m.OnlineOrdersPage),
  'commandes/retirees': () => import('./pages/orders/orders.page').then((m) => m.OnlineOrdersPage),
  'commandes/annulees': () => import('./pages/orders/orders.page').then((m) => m.OnlineOrdersPage),
  'inventaires/nouveau': () => import('./pages/inventory/new-inventory.page').then((m) => m.NewInventoryPage),
  'inventaires/en-cours': () => import('./pages/inventory/inventories.page').then((m) => m.InventoriesPage),
  'inventaires/mes-comptages': () => import('./pages/inventory/counting.page').then((m) => m.CountingPage),
  'inventaires/historique': () => import('./pages/inventory/inventories.page').then((m) => m.InventoriesPage),
};

function detail(path: string, title: string, permission: string, load: LazyComponent): Route {
  return { path, title: `${title} · Librairie`, canActivate: [permissionGuard], data: { permission }, loadComponent: load };
}

/** Écrans de détail rattachés à une section (création / modification), avec leur permission. */
const DETAIL_ROUTES: Record<string, Routes> = {
  catalogue: [
    {
      path: 'articles/nouveau',
      title: 'Nouvel article · Librairie',
      canActivate: [permissionGuard],
      data: { permission: 'catalog.manage' },
      loadComponent: () => import('./pages/catalog/article-form.page').then((m) => m.ArticleFormPage),
    },
    {
      path: 'articles/:id',
      title: 'Article · Librairie',
      canActivate: [permissionGuard],
      data: { permission: 'catalog.view' },
      loadComponent: () => import('./pages/catalog/article-form.page').then((m) => m.ArticleFormPage),
    },
    {
      path: 'kits/nouveau',
      title: 'Nouveau kit · Librairie',
      canActivate: [permissionGuard],
      data: { permission: 'catalog.manage' },
      loadComponent: () => import('./pages/catalog/kit-form.page').then((m) => m.KitFormPage),
    },
    {
      path: 'kits/:id',
      title: 'Kit scolaire · Librairie',
      canActivate: [permissionGuard],
      data: { permission: 'catalog.view' },
      loadComponent: () => import('./pages/catalog/kit-form.page').then((m) => m.KitFormPage),
    },
  ],
  stock: [
    detail('transferts/nouveau', 'Nouveau transfert', 'stock.transfer',
      () => import('./pages/stock/transfer-form.page').then((m) => m.TransferFormPage)),
    detail('transferts/:id', 'Transfert', 'stock.view',
      () => import('./pages/stock/transfer-form.page').then((m) => m.TransferFormPage)),
  ],
  commandes: [
    detail('detail/:id', 'Commande en ligne', 'orders.view',
      () => import('./pages/orders/order-detail.page').then((m) => m.OrderDetailPage)),
    detail('preparation/:id', 'Préparation de commande', 'orders.prepare',
      () => import('./pages/orders/preparation.page').then((m) => m.PreparationPage)),
  ],
  inventaires: [
    detail('sessions/:id', 'Inventaire', 'inventory.view',
      () => import('./pages/inventory/inventory-detail.page').then((m) => m.InventoryDetailPage)),
  ],
  achats: [
    detail('bons-de-commande/nouveau', 'Nouveau bon de commande', 'purchasing.manage',
      () => import('./pages/purchasing/order-form.page').then((m) => m.OrderFormPage)),
    detail('bons-de-commande/:id', 'Bon de commande', 'purchasing.view',
      () => import('./pages/purchasing/order-form.page').then((m) => m.OrderFormPage)),
    detail('receptions/nouvelle', 'Nouvelle réception', 'purchasing.receive',
      () => import('./pages/purchasing/receipt-form.page').then((m) => m.ReceiptFormPage)),
    detail('receptions/:id', 'Réception', 'purchasing.view',
      () => import('./pages/purchasing/receipt-form.page').then((m) => m.ReceiptFormPage)),
  ],
};

function linkRoute(section: MenuSection, link: MenuLink): Route {
  const key = `${section.path}/${link.path}`;
  return {
    path: link.path,
    title: `${link.label} · Librairie`,
    canActivate: [permissionGuard],
    data: {
      permission: link.permission,
      section: section.label,
      title: link.label,
      phase: link.phase,
      description: link.description,
      requiresOnline: link.requiresOnline ?? false,
      connectionsOnly: key === 'audit/connexions',
    },
    loadComponent:
      IMPLEMENTED[key] ?? (() => import('./pages/module/module.page').then((m) => m.ModulePage)),
  };
}

function sectionRoutes(): Routes {
  return MENU.filter((section) => section.children.length > 0).map((section) => ({
    path: section.path,
    canActivate: [permissionGuard],
    data: { anyPermission: sectionPermissions(section) },
    children: [
      { path: '', pathMatch: 'full', redirectTo: section.children[0].path },
      ...(DETAIL_ROUTES[section.path] ?? []),
      ...section.children.map((link) => linkRoute(section, link)),
    ],
  }));
}

export const routes: Routes = [
  {
    path: 'connexion',
    title: 'Connexion · Librairie',
    canMatch: [guestGuard],
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'verrouillage',
    title: 'Reprendre la main · Librairie',
    loadComponent: () => import('./pages/login/unlock.page').then((m) => m.UnlockPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tableau-de-bord' },
      {
        path: 'tableau-de-bord',
        title: 'Tableau de bord · Librairie',
        loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'mon-profil',
        title: 'Mon profil · Librairie',
        loadComponent: () => import('./pages/profile/profile.page').then((m) => m.ProfilePage),
      },
      ...sectionRoutes(),
      {
        path: 'acces-refuse',
        title: 'Accès refusé · Librairie',
        loadComponent: () => import('./pages/errors/forbidden.page').then((m) => m.ForbiddenPage),
      },
      {
        path: '**',
        title: 'Page introuvable · Librairie',
        loadComponent: () => import('./pages/errors/not-found.page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
