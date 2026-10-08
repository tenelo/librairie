/**
 * Définition des menus du backoffice (section 11 de la spécification).
 *
 * Chaque entrée porte la permission requise : le menu affiché et les gardes de routes
 * utilisent la même source, cohérente avec les permissions DRF côté serveur.
 * `phase` indique la phase de réalisation des écrans encore en construction ;
 * `requiresOnline` signale les écrans qui exigent le serveur.
 */
export interface MenuLink {
  label: string;
  path: string;
  permission?: string;
  phase?: number;
  requiresOnline?: boolean;
  description?: string;
}

export interface MenuSection {
  label: string;
  icon: string;
  path: string;
  permission?: string;
  children: MenuLink[];
}

export const MENU: MenuSection[] = [
  {
    label: 'Tableau de bord',
    icon: 'dashboard',
    path: 'tableau-de-bord',
    permission: 'dashboard.view',
    children: [],
  },
  {
    label: 'Caisse',
    icon: 'point_of_sale',
    path: 'caisse',
    children: [
      { label: 'Nouvelle vente', path: 'nouvelle-vente', permission: 'sales.create' },
      { label: 'Ventes en attente', path: 'en-attente', permission: 'sales.hold' },
      { label: 'Historique des ventes', path: 'historique', permission: 'sales.view' },
      { label: 'Retours', path: 'retours', permission: 'sales.return' },
      { label: 'Ouverture / Clôture', path: 'sessions', permission: 'cash.open_close' },
      { label: 'Rapports Z', path: 'rapports-z', permission: 'cash.z_report' },
    ],
  },
  {
    label: 'Commandes en ligne',
    icon: 'shopping_bag',
    path: 'commandes',
    children: [
      { label: 'À confirmer', path: 'a-confirmer', permission: 'orders.confirm' },
      { label: 'À préparer', path: 'a-preparer', permission: 'orders.prepare' },
      { label: 'Prêtes', path: 'pretes', permission: 'orders.view' },
      { label: 'Retirées', path: 'retirees', permission: 'orders.view' },
      { label: 'Annulées / Expirées', path: 'annulees', permission: 'orders.view' },
    ],
  },
  {
    label: 'Catalogue',
    icon: 'menu_book',
    path: 'catalogue',
    children: [
      { label: 'Articles', path: 'articles', permission: 'catalog.view' },
      { label: 'Kits scolaires', path: 'kits', permission: 'catalog.view' },
      { label: 'Catégories', path: 'categories', permission: 'catalog.view' },
      { label: 'Niveaux & établissements', path: 'niveaux', permission: 'catalog.view' },
      { label: 'Étiquettes codes-barres', path: 'etiquettes', permission: 'catalog.view' },
      { label: 'Import / Export', path: 'import-export', permission: 'catalog.import',
        requiresOnline: true },
    ],
  },
  {
    label: 'Stock',
    icon: 'inventory_2',
    path: 'stock',
    children: [
      { label: 'État des stocks', path: 'etat', permission: 'stock.view' },
      { label: 'Mouvements', path: 'mouvements', permission: 'stock.view' },
      { label: 'Transferts', path: 'transferts', permission: 'stock.transfer' },
      { label: 'Assemblage de kits', path: 'assemblage', permission: 'stock.kit_assembly' },
      { label: 'Pertes / Casse', path: 'pertes', permission: 'stock.manage' },
      { label: 'Alertes', path: 'alertes', permission: 'stock.view' },
    ],
  },
  {
    label: 'Achats',
    icon: 'local_shipping',
    path: 'achats',
    children: [
      { label: 'Fournisseurs', path: 'fournisseurs', permission: 'purchasing.view' },
      { label: 'Bons de commande', path: 'bons-de-commande', permission: 'purchasing.view' },
      { label: 'Réceptions', path: 'receptions', permission: 'purchasing.receive' },
      { label: 'Suggestions de réapprovisionnement', path: 'suggestions', permission: 'purchasing.view' },
    ],
  },
  {
    label: 'Inventaires',
    icon: 'fact_check',
    path: 'inventaires',
    children: [
      { label: 'Nouvel inventaire', path: 'nouveau', permission: 'inventory.create' },
      { label: 'Inventaires en cours', path: 'en-cours', permission: 'inventory.view' },
      { label: 'Mes comptages', path: 'mes-comptages', permission: 'inventory.count' },
      { label: 'Historique et écarts', path: 'historique', permission: 'inventory.view' },
    ],
  },
  {
    label: 'Clients',
    icon: 'groups',
    path: 'clients',
    children: [
      { label: 'Clients', path: 'liste', permission: 'customers.view' },
      { label: 'Établissements scolaires', path: 'etablissements', permission: 'customers.view' },
      { label: 'Crédits et avoirs', path: 'credits', permission: 'customers.manage' },
      { label: 'Fidélité', path: 'fidelite', permission: 'customers.manage' },
    ],
  },
  {
    label: 'Statistiques',
    icon: 'insights',
    path: 'statistiques',
    children: [
      { label: 'Ventes', path: 'ventes', permission: 'stats.view', phase: 9, requiresOnline: true },
      { label: 'Kits', path: 'kits', permission: 'stats.view', phase: 9, requiresOnline: true },
      { label: 'Stock', path: 'stock', permission: 'stats.view', phase: 9, requiresOnline: true },
      { label: 'Commandes en ligne', path: 'commandes', permission: 'stats.view', phase: 9, requiresOnline: true },
      { label: 'Caisses', path: 'caisses', permission: 'stats.view', phase: 9, requiresOnline: true },
      { label: 'Inventaires', path: 'inventaires', permission: 'stats.view', phase: 9, requiresOnline: true },
    ],
  },
  {
    label: 'Audit',
    icon: 'policy',
    path: 'audit',
    children: [
      { label: "Journal d'audit", path: 'journal', permission: 'audit.view', requiresOnline: true },
      { label: 'Connexions', path: 'connexions', permission: 'audit.view', requiresOnline: true },
    ],
  },
  {
    label: 'Synchronisation',
    icon: 'sync',
    path: 'synchronisation',
    children: [
      { label: 'État', path: 'etat', permission: 'sync.view' },
      { label: "File d'attente", path: 'file', permission: 'sync.view' },
      { label: 'Conflits', path: 'conflits', permission: 'sync.view', requiresOnline: true },
    ],
  },
  {
    label: 'Administration',
    icon: 'admin_panel_settings',
    path: 'administration',
    children: [
      { label: 'Utilisateurs', path: 'utilisateurs', permission: 'accounts.manage_users', requiresOnline: true },
      { label: 'Rôles & permissions', path: 'roles', permission: 'accounts.manage_roles', requiresOnline: true },
      { label: 'Terminaux', path: 'terminaux', permission: 'accounts.manage_devices', requiresOnline: true },
      { label: 'Dépôts', path: 'depots', permission: 'settings.manage', requiresOnline: true },
      { label: 'Moyens de paiement', path: 'moyens-de-paiement', permission: 'settings.manage',
        requiresOnline: true },
      { label: 'Paramètres librairie et reçus', path: 'parametres', permission: 'settings.manage',
        requiresOnline: true },
      { label: 'Notifications', path: 'notifications', permission: 'settings.manage', requiresOnline: true },
    ],
  },
];

/** Filtre le menu selon les permissions de l'utilisateur ; une section sans lien visible disparaît. */
export function visibleMenu(menu: MenuSection[], can: (permission?: string) => boolean): MenuSection[] {
  return menu
    .filter((section) => can(section.permission))
    .map((section) => ({ ...section, children: section.children.filter((link) => can(link.permission)) }))
    .filter((section) => section.children.length > 0 || section.permission !== undefined);
}

/** Toutes les permissions donnant accès à une section (pour la garde de la route parente). */
export function sectionPermissions(section: MenuSection): string[] {
  return section.children.map((link) => link.permission).filter((p): p is string => !!p);
}
