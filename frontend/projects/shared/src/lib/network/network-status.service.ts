import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Statut réseau du navigateur (événements `online` / `offline`). */
@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  readonly online = signal<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly lastChange = signal<Date | null>(null);

  constructor() {
    const update = () => {
      this.online.set(navigator.onLine);
      this.lastChange.set(new Date());
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
}
