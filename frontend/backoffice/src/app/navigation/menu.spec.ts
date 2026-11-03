import { Route } from '@angular/router';

import { routes } from '../app.routes';
import { ONLINE_SALES_ENABLED } from '../features';
import { MENU, sectionPermissions, visibleMenu } from './menu';

const CAISSIER = new Set([
  'dashboard.view',
  'catalog.view',
  'stock.view',
  'sync.view',
  'sales.create',
  'sales.view',
  'sales.hold',
  'sales.return',
  'cash.open_close',
  'cash.z_report',
  'customers.view',
  'customers.manage',
  'orders.view',
  'orders.pickup',
]);

function labels(can: (p?: string) => boolean): string[] {
  return visibleMenu(MENU, can).map((section) => section.label);
}

describe('menus du backoffice', () => {
  const ONLINE = ONLINE_SALES_ENABLED ? ['Commandes en ligne'] : [];
  const COUNT = ONLINE_SALES_ENABLED ? 13 : 12;

  it('contient les menus de la spécification, dans l’ordre', () => {
    expect(MENU.map((s) => s.label)).toEqual([
      'Tableau de bord',
      'Caisse',
      ...ONLINE,
      'Catalogue',
      'Stock',
      'Achats',
      'Inventaires',
      'Clients',
      'Tontines',
      'Statistiques',
      'Audit',
      'Synchronisation',
      'Administration',
    ]);
  });

  it('montre tout à un administrateur', () => {
    expect(labels(() => true).length).toBe(COUNT);
  });

  it('filtre selon les permissions d’un caissier', () => {
    const can = (p?: string) => !p || CAISSIER.has(p);
    const visible = visibleMenu(MENU, can);
    expect(visible.map((s) => s.label)).not.toContain('Administration');
    expect(visible.map((s) => s.label)).not.toContain('Audit');
    expect(visible.map((s) => s.label)).not.toContain('Achats');
    const caisse = visible.find((s) => s.label === 'Caisse');
    expect(caisse?.children.length).toBe(6);
    if (ONLINE_SALES_ENABLED) {
      const commandes = visible.find((s) => s.label === 'Commandes en ligne');
      expect(commandes?.children.map((c) => c.label)).not.toContain('À confirmer');
    }
  });

  it('chaque lien de menu possède une route protégée par sa permission', () => {
    const shell = routes.find((r) => r.path === '' && r.children);
    const children = shell?.children ?? [];
    for (const section of MENU.filter((s) => s.children.length)) {
      const parent = children.find((r) => r.path === section.path) as Route;
      expect(parent).withContext(section.path).toBeDefined();
      expect(parent.data?.['anyPermission']).toEqual(sectionPermissions(section));
      for (const link of section.children) {
        const child = parent.children?.find((r) => r.path === link.path);
        expect(child).withContext(`${section.path}/${link.path}`).toBeDefined();
        expect(child?.data?.['permission']).toBe(link.permission);
        expect(child?.canActivate?.length).toBe(1);
      }
    }
  });

  it('masque la vente en ligne tant qu’elle est désactivée', () => {
    if (ONLINE_SALES_ENABLED) {
      return;
    }
    expect(MENU.some((s) => s.onlineSales)).toBeFalse();
    expect(MENU.flatMap((s) => s.children).some((c) => c.onlineSales)).toBeFalse();
  });

  it('marque les écrans qui exigent une connexion', () => {
    const admin = MENU.find((s) => s.path === 'administration');
    expect(admin?.children.find((c) => c.path === 'utilisateurs')?.requiresOnline).toBeTrue();
    const stats = MENU.find((s) => s.path === 'statistiques');
    expect(stats?.children.every((c) => c.requiresOnline)).toBeTrue();
  });
});
