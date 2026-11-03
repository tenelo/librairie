import { ONLINE_SALES_ENABLED } from '../features';

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
  /** Écran lié à la vente en ligne : masqué tant que ONLINE_SALES_ENABLED vaut false. */
  onlineSales?: boolean;
  permission?: string;
  phase?: number;
  requiresOnline?: boolean;
  description?: string;
}

export interface MenuSection {
  label: string;
  icon: string;
  path: string;
  /** Section liée à la vente en ligne : masquée tant que ONLINE_SALES_ENABLED vaut false. */
  onlineSales?: boolean;
  permission?: string;
  children: MenuLink[];
}

const ALL_MENU: MenuSection[] = [
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
    onlineSales: true,
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
    label: 'Tontines',
    icon: 'savings',
    path: 'tontine-scolaire',
    children: [
      { label: 'Souscriptions', path: 'souscriptions', permission: 'tontines.view', requiresOnline: true },
      { label: 'Historique', path: 'historique', permission: 'tontines.view', requiresOnline: true },
    ],
  },
  {
    label: 'Statistiques',
    icon: 'insights',
    path: 'statistiques',
    children: [
      { label: 'Ventes', path: 'ventes', permission: 'stats.view', requiresOnline: true },
      { label: 'Kits', path: 'kits', permission: 'stats.view', requiresOnline: true },
      { label: 'Stock', path: 'stock', permission: 'stats.view', requiresOnline: true },
      { label: 'Commandes en ligne', path: 'commandes', permission: 'stats.view', requiresOnline: true, onlineSales: true },
      { label: 'Caisses', path: 'caisses', permission: 'stats.view', requiresOnline: true },
      { label: 'Inventaires', path: 'inventaires', permission: 'stats.view', requiresOnline: true },
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
      { label: 'Librairies', path: 'librairies', permission: 'settings.manage', requiresOnline: true },
      { label: 'Utilisateurs', path: 'utilisateurs', permission: 'accounts.manage_users', requiresOnline: true },
      { label: 'Rôles & permissions', path: 'roles', permission: 'accounts.manage_roles', requiresOnline: true },
      { label: 'Terminaux', path: 'terminaux', permission: 'accounts.manage_devices', requiresOnline: true },
      { label: 'Dépôts', path: 'depots', permission: 'settings.manage', requiresOnline: true },
      { label: 'Moyens de paiement', path: 'moyens-de-paiement', permission: 'settings.manage',
        requiresOnline: true },
      { label: 'Paramètres librairie et reçus', path: 'parametres', permission: 'settings.manage',
        requiresOnline: true },
      { label: 'Notifications', path: 'notifications', permission: 'settings.manage', requiresOnline: true },
      { label: 'Installation', path: 'installation', permission: 'settings.manage' },
    ],
  },
];

/**
 * Menu effectif : sans la vente en ligne tant qu'elle est désactivée (features.ts).
 * Les routes étant construites à partir de MENU, les écrans masqués sont aussi inaccessibles par URL.
 */
export const MENU: MenuSection[] = ALL_MENU.filter((section) => ONLINE_SALES_ENABLED || !section.onlineSales).map(
  (section) => ({
    ...section,
    children: section.children.filter((link) => ONLINE_SALES_ENABLED || !link.onlineSales),
  }),
);

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
