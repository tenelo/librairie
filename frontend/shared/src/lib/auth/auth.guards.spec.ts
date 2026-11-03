import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { makeProfile, storeSession, testProviders } from '../testing/test-helpers';
import { authGuard, permissionGuard } from './auth.guards';

function route(data: Record<string, unknown>): ActivatedRouteSnapshot {
  return { data } as unknown as ActivatedRouteSnapshot;
}

const state = { url: '/caisse/nouvelle-vente' } as RouterStateSnapshot;

describe('gardes de routes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function run<T>(fn: () => T): T {
    TestBed.configureTestingModule({ providers: testProviders() });
    return TestBed.runInInjectionContext(fn);
  }

  it('authGuard redirige vers la connexion en conservant la cible', () => {
    const result = run(() => authGuard(route({}), state)) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/connexion?retour=%2Fcaisse%2Fnouvelle-vente');
  });

  it('authGuard laisse passer un utilisateur connecté', () => {
    storeSession();
    expect(run(() => authGuard(route({}), state))).toBeTrue();
  });

  it('permissionGuard applique la permission de la route', () => {
    storeSession({ user: makeProfile({ permissions: ['sales.create'] }) });
    expect(run(() => permissionGuard(route({ permission: 'sales.create' }), state))).toBeTrue();
    const denied = TestBed.runInInjectionContext(() =>
      permissionGuard(route({ permission: 'inventory.validate' }), state),
    ) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(denied)).toBe('/acces-refuse');
  });

  it('permissionGuard accepte une permission parmi plusieurs', () => {
    storeSession({ user: makeProfile({ permissions: ['orders.prepare'] }) });
    expect(
      run(() => permissionGuard(route({ anyPermission: ['orders.confirm', 'orders.prepare'] }), state)),
    ).toBeTrue();
  });
});
