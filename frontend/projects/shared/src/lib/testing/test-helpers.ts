import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';

import { authInterceptor } from '../auth/auth.interceptor';
import { APP_CONFIG } from '../config/app-config';
import { StoredSession, UserProfile } from '../models/auth.models';

export const TEST_CONFIG = { apiBaseUrl: '/api', app: 'backoffice' as const, loginPath: '/connexion' };
export const SESSION_KEY = 'librairie.backoffice.session';

export function testProviders(): (Provider | EnvironmentProviders)[] {
  return [
    { provide: APP_CONFIG, useValue: TEST_CONFIG },
    provideRouter([]),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideHttpClientTesting(),
  ];
}

export function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: '7f1d6c2e-0000-4000-8000-000000000001',
    username: 'caisse1',
    first_name: 'Aya',
    last_name: 'Traoré',
    full_name: 'Aya Traoré',
    email: '',
    phone: '+2250701020304',
    role: { code: 'CAISSIER', label: 'Caissier', is_staff_role: true, max_discount_percent: 5 },
    permissions: ['dashboard.view', 'sales.create', 'cash.open_close'],
    has_pin: false,
    offline_max_hours: 72,
    must_change_password: false,
    is_superuser: false,
    ...overrides,
  };
}

export function storeSession(session: Partial<StoredSession> = {}): void {
  const full: StoredSession = {
    access: 'access-1',
    refresh: 'refresh-1',
    user: makeProfile(),
    lastOnlineAuthAt: new Date().toISOString(),
    ...session,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(full));
}
