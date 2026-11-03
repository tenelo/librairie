import { Injectable, computed, signal } from '@angular/core';

const LAST_SYNC_KEY = 'librairie.lastSyncAt';

/**
 * État de synchronisation affiché en permanence dans le backoffice :
 * nombre d'opérations en attente dans l'outbox et date de dernière synchronisation.
 * Le moteur de synchronisation (phase 4) alimente ces signaux.
 */
@Injectable({ providedIn: 'root' })
export class SyncStatusService {
  readonly pendingCount = signal(0);
  readonly errorCount = signal(0);
  readonly syncing = signal(false);
  readonly lastSyncAt = signal<Date | null>(this.loadLastSync());

  readonly hasPending = computed(() => this.pendingCount() > 0);

  markSynced(at: Date = new Date()): void {
    localStorage.setItem(LAST_SYNC_KEY, at.toISOString());
    this.lastSyncAt.set(at);
  }

  private loadLastSync(): Date | null {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    return raw ? new Date(raw) : null;
  }
}
