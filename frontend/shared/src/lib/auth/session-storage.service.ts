import { Injectable, inject } from '@angular/core';

import { APP_CONFIG } from '../config/app-config';
import { StoredSession } from '../models/auth.models';

/**
 * Persistance locale de la session (jetons + profil).
 *
 * Le profil est conservé pour permettre la reprise hors connexion ; la base locale
 * IndexedDB (Dexie) prendra le relais pour les données métier en phase 4.
 */
@Injectable({ providedIn: 'root' })
export class SessionStorageService {
  private readonly key = `librairie.${inject(APP_CONFIG).app}.session`;

  read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  }

  write(session: StoredSession): void {
    localStorage.setItem(this.key, JSON.stringify(session));
  }

  clear(): void {
    localStorage.removeItem(this.key);
  }
}
