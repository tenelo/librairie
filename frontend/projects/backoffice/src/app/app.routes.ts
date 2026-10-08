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
};

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
