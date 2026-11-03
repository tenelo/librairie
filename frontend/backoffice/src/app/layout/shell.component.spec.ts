import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { APP_CONFIG } from '@librairie/shared';

import { ShellComponent } from './shell.component';

function storeSession(permissions: string[]): void {
  localStorage.setItem(
    'librairie.backoffice.session',
    JSON.stringify({
      access: 'a',
      refresh: 'r',
      lastOnlineAuthAt: new Date().toISOString(),
      user: {
        id: '1',
        username: 'caisse1',
        first_name: 'Aya',
        last_name: 'Traoré',
        full_name: 'Aya Traoré',
        email: '',
        phone: null,
        role: { code: 'CAISSIER', label: 'Caissier', is_staff_role: true, max_discount_percent: 5 },
        permissions,
        has_pin: false,
        offline_max_hours: 72,
        must_change_password: false,
        is_superuser: false,
      },
    }),
  );
}

describe('ShellComponent', () => {
  beforeEach(() => {
    localStorage.clear();
    storeSession(['dashboard.view', 'sales.create', 'cash.open_close']);
    TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: APP_CONFIG, useValue: { apiBaseUrl: '/api', app: 'backoffice', loginPath: '/connexion' } },
        { provide: SwUpdate, useValue: { isEnabled: false } },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  it('affiche les indicateurs, l’utilisateur et uniquement les menus autorisés', () => {
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Aya Traoré');
    expect(text).toContain('Tableau de bord');
    expect(text).toContain('Caisse');
    expect(text).not.toContain('Administration');
    expect(text).not.toContain('Statistiques');
    expect(text).toMatch(/En ligne|Hors ligne/);
    expect(text).toContain('en attente');
  });
});
