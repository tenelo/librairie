import { HttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { storeSession, testProviders } from '../testing/test-helpers';
import { AuthService } from './auth.service';
import { DeviceService } from './device.service';

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;

  beforeEach(() => {
    localStorage.clear();
    storeSession();
    TestBed.configureTestingModule({ providers: testProviders() });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('ajoute le jeton, le code terminal et la date client', () => {
    TestBed.inject(DeviceService).register({ code: 'c02', name: 'Caisse 2' });
    client.get('/api/auth/me/').subscribe();
    const req = http.expectOne('/api/auth/me/');
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(req.request.headers.get('X-Device-Code')).toBe('C02');
    expect(Date.parse(req.request.headers.get('X-Client-Timestamp') ?? '')).not.toBeNaN();
    req.flush({});
  });

  it('ne touche pas aux requêtes hors API', () => {
    client.get('/assets/config.json').subscribe();
    const req = http.expectOne('/assets/config.json');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('renouvelle le jeton sur 401 puis rejoue la requête', () => {
    let body: unknown;
    client.get('/api/settings/library/').subscribe((b) => (body = b));
    http.expectOne('/api/settings/library/').flush({ detail: 'expiré' }, { status: 401, statusText: 'Unauthorized' });

    const refresh = http.expectOne('/api/auth/refresh/');
    expect(refresh.request.headers.has('Authorization')).toBeFalse();
    refresh.flush({ access: 'access-2', refresh: 'refresh-2' });

    const retry = http.expectOne('/api/settings/library/');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer access-2');
    retry.flush({ name: 'Librairie' });
    expect(body).toEqual({ name: 'Librairie' });
  });

  it('ferme la session si le renouvellement échoue', () => {
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    let failed = false;
    client.get('/api/accounts/users/').subscribe({ error: () => (failed = true) });
    http.expectOne('/api/accounts/users/').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh/').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/logout/').flush(null);

    expect(failed).toBeTrue();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBeFalse();
    expect(navigate).toHaveBeenCalledWith('/connexion');
  });
});
