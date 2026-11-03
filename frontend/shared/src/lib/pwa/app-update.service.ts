import { ApplicationRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, first } from 'rxjs';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Détection des nouvelles versions de la PWA via `SwUpdate`.
 * Le rechargement ne touche pas aux données locales (localStorage / IndexedDB) :
 * l'outbox est conservée.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);

  readonly updateAvailable = signal(false);

  constructor() {
    if (!this.updates.isEnabled) {
      return;
    }
    this.updates.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => this.updateAvailable.set(true));
    this.updates.unrecoverable.subscribe(() => this.updateAvailable.set(true));

    // Vérification périodique, une fois l'application stabilisée.
    this.appRef.isStable.pipe(first((stable) => stable)).subscribe(() => {
      void this.updates.checkForUpdate().catch(() => undefined);
      setInterval(() => void this.updates.checkForUpdate().catch(() => undefined), CHECK_INTERVAL_MS);
    });
  }

  async applyUpdate(): Promise<void> {
    if (this.updates.isEnabled) {
      await this.updates.activateUpdate().catch(() => undefined);
    }
    document.location.reload();
  }
}
