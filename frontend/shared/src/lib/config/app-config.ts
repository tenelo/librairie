import { InjectionToken } from '@angular/core';

export type AppKind = 'backoffice' | 'boutique';

export interface LibrairieAppConfig {
  /** Préfixe des appels API, relatif (`/api`) : servi par le proxy de dev ou par nginx. */
  apiBaseUrl: string;
  /** Application courante : détermine le contrôle d'accès à la connexion. */
  app: AppKind;
  /** Route de l'écran de connexion. */
  loginPath: string;
}

export const APP_CONFIG = new InjectionToken<LibrairieAppConfig>('APP_CONFIG');
