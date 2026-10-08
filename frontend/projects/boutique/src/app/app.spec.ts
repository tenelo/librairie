import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '@librairie/shared';

import { routes } from './app.routes';
import { ShopInfoService } from './services/shop-info.service';

describe('boutique', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { apiBaseUrl: '/api', app: 'boutique', loginPath: '/connexion' } },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  it('déclare les écrans client attendus', () => {
    const paths = routes[0].children?.map((r) => r.path) ?? [];
    expect(paths).toEqual(jasmine.arrayContaining(['', 'catalogue', 'connexion', 'inscription', 'mon-compte']));
  });

  it('met en cache les informations publiques pour un affichage hors ligne', () => {
    const service = TestBed.inject(ShopInfoService);
    service.load();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/settings/public/').flush({
      name: 'Librairie du Plateau',
      logo: null,
      address: 'Avenue Chardy',
      city: 'Abidjan',
      phone: '27 20 00 00 00',
      email: '',
      website: '',
      order_expiry_hours: 72,
    });
    expect(service.info()?.name).toBe('Librairie du Plateau');
    http.verify();

    // Une nouvelle instance (rechargement hors ligne) relit le cache local.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_CONFIG, useValue: { apiBaseUrl: '/api', app: 'boutique', loginPath: '/connexion' } },
      ],
    });
    expect(TestBed.inject(ShopInfoService).info()?.city).toBe('Abidjan');
  });
});
