import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { APP_CONFIG } from '../config/app-config';
import { NetworkStatusService } from '../network/network-status.service';
import { SyncStatusService } from '../sync/sync-status.service';
import { SyncedRow } from './local-db';
import { LocalDbService } from './local-db.service';
import { OutboxService } from './outbox.service';

export interface PushResult {
  id: string;
  status: 'ok' | 'conflict' | 'error';
  error?: string;
  result?: unknown;
  server_version?: unknown;
}

export interface PullResult {
  cursor: number;
  has_more: boolean;
  changes: Record<string, SyncedRow[]>;
}

export const BACKGROUND_SYNC_TAG = 'librairie-sync';

/**
 * Moteur de synchronisation : envoie l'outbox (`sync/push`) puis descend les modifications
 * (`sync/pull`). Déclenché au démarrage, au retour du réseau, toutes les N minutes en ligne,
 * manuellement, et par la Background Sync du navigateur quand elle est disponible.
 */
@Injectable({ providedIn: 'root' })
export class SyncEngineService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/sync`;
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);
  private readonly status = inject(SyncStatusService);
  private readonly outbox = inject(OutboxService);
  private readonly local = inject(LocalDbService);

  readonly lastError = signal<string | null>(null);
  private readonly active = signal(false);
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Synchronisation au démarrage, à la connexion d'un utilisateur et au retour du réseau.
    effect(() => {
      const ready = this.active() && this.network.online() && this.auth.isAuthenticated();
      untracked(() => {
        if (ready) {
          void this.syncNow();
        }
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Démarre les déclencheurs automatiques (appelé par le layout du backoffice). */
  start(): void {
    if (this.active()) {
      return;
    }
    this.active.set(true);
    void this.refreshCounts();
    void this.local.getMeta<number>('syncIntervalMinutes', 5).then((minutes) => this.schedule(minutes));
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        if ((event.data as { type?: string } | null)?.type === BACKGROUND_SYNC_TAG) {
          void this.syncNow();
        }
      });
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  schedule(minutes: number): void {
    this.stop();
    this.timer = setInterval(() => void this.syncNow(), Math.max(1, minutes) * 60_000);
  }

  /** Demande une Background Sync au navigateur (réveil du terminal au retour du réseau). */
  async requestBackgroundSync(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker?.ready;
      const sync = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })
        ?.sync;
      await sync?.register(BACKGROUND_SYNC_TAG);
    } catch {
      // Navigateur sans Background Sync : la boucle applicative prend le relais.
    }
  }

  /** Lance une synchronisation complète (les appels simultanés partagent la même exécution). */
  syncNow(): Promise<void> {
    if (!this.network.online() || !this.auth.isAuthenticated()) {
      return this.refreshCounts();
    }
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(): Promise<void> {
    this.status.syncing.set(true);
    this.lastError.set(null);
    try {
      await this.pushAll();
      await this.pullAll();
      this.status.markSynced();
      const settings = await this.local.db.settings.toCollection().first();
      const minutes = Number(settings?.['sync_interval_minutes'] ?? 5);
      if (minutes !== (await this.local.getMeta<number>('syncIntervalMinutes', 5))) {
        await this.local.setMeta('syncIntervalMinutes', minutes);
        this.schedule(minutes);
      }
    } catch (error) {
      console.error('Synchronisation', error);
      this.lastError.set(error instanceof HttpErrorResponse && error.status === 0
        ? 'Serveur injoignable' : 'La synchronisation a échoué');
    } finally {
      this.status.syncing.set(false);
      await this.refreshCounts();
    }
  }

  async pushAll(): Promise<void> {
    for (let round = 0; round < 20; round++) {
      const batch = await this.outbox.due(50);
      if (!batch.length) {
        return;
      }
      let response: { results: PushResult[] };
      try {
        response = await firstValueFrom(this.http.post<{ results: PushResult[] }>(`${this.api}/push/`, {
          operations: batch.map(({ id, entity, operation, payload, client_timestamp }) => ({
            id, entity, operation, payload, client_timestamp })),
        }));
      } catch (error) {
        await this.outbox.postpone(batch.map((e) => e.id),
          error instanceof HttpErrorResponse ? `Erreur réseau (${error.status})` : 'Erreur réseau');
        throw error;
      }
      const accepted: string[] = [];
      for (const result of response.results) {
        if (result.status === 'ok') {
          accepted.push(result.id);
        } else {
          await this.outbox.reject(result.id, result.status === 'conflict'
            ? `Conflit : ${result.error ?? 'donnée modifiée sur le serveur'}` : result.error ?? 'Refusé par le serveur');
        }
      }
      await this.outbox.acknowledge(accepted);
    }
  }

  async pullAll(): Promise<void> {
    let cursor = await this.local.getMeta<number>('cursor', 0);
    for (let page = 0; page < 200; page++) {
      const result = await firstValueFrom(this.http.get<PullResult>(`${this.api}/pull/`, {
        params: { since: cursor, limit: 500 },
      }));
      await this.local.applyChanges(result.changes);
      cursor = result.cursor;
      await this.local.setMeta('cursor', cursor);
      if (!result.has_more) {
        return;
      }
    }
  }

  async refreshCounts(): Promise<void> {
    const counts = await this.outbox.counts();
    this.status.pendingCount.set(counts.pending);
    this.status.errorCount.set(counts.errors);
  }
}
