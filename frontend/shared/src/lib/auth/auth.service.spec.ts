import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SESSION_KEY, makeProfile, storeSession, testProviders } from '../testing/test-helpers';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let http: HttpTestingController;

  function setup(): AuthService {
    TestBed.configureTestingModule({ providers: testProviders() });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('se connecte, conserve la session et expose les permissions', () => {
    const auth = setup();
    let username = '';
    auth.login('caisse1', 'secret').subscribe((user) => (username = user.username));

    const req = http.expectOne('/api/auth/login/');
    expect(req.request.body).toEqual({ identifier: 'caisse1', password: 'secret', app: 'backoffice' });
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({ access: 'a1', refresh: 'r1', user: makeProfile() });

    expect(username).toBe('caisse1');
    expect(auth.isAuthenticated()).toBeTrue();
    expect(auth.accessToken).toBe('a1');
    expect(auth.hasPermission('sales.create')).toBeTrue();
    expect(auth.hasPermission('accounts.manage_users')).toBeFalse();
    expect(auth.hasAnyPermission(['stats.view', 'cash.open_close'])).toBeTrue();
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}');
    expect(stored.user.username).toBe('caisse1');
    expect(stored.lastOnlineAuthAt).toBeTruthy();
  });

  it('restaure la session enregistrée (reprise hors ligne)', () => {
    storeSession();
    const auth = setup();
    expect(auth.isAuthenticated()).toBeTrue();
    expect(auth.user()?.full_name).toBe('Aya Traoré');
  });

  it('accorde tout au super-utilisateur', () => {
    storeSession({ user: makeProfile({ is_superuser: true, permissions: [] }) });
    const auth = setup();
    expect(auth.hasPermission('settings.manage')).toBeTrue();
  });

  it('mutualise les renouvellements de jeton concurrents (rotation)', () => {
    storeSession();
    const auth = setup();
    const tokens: string[] = [];
    auth.refreshAccessToken().subscribe((t) => tokens.push(t));
    auth.refreshAccessToken().subscribe((t) => tokens.push(t));

    const req = http.expectOne('/api/auth/refresh/');
    expect(req.request.body).toEqual({ refresh: 'refresh-1' });
    req.flush({ access: 'access-2', refresh: 'refresh-2' });

    expect(tokens).toEqual(['access-2', 'access-2']);
    expect(auth.accessToken).toBe('access-2');
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}').refresh).toBe('refresh-2');
  });

  it('se déconnecte localement et invalide le jeton côté serveur', () => {
    storeSession();
    const auth = setup();
    auth.logout(false);
    expect(auth.isAuthenticated()).toBeFalse();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    const req = http.expectOne('/api/auth/logout/');
    expect(req.request.body).toEqual({ refresh: 'refresh-1' });
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-1');
    req.flush(null, { status: 205, statusText: 'Reset Content' });
  });
});
