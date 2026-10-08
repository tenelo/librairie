import { Injectable, inject } from '@angular/core';

import { DeviceService } from '../auth/device.service';
import { OutboxEntry, StockDelta } from './local-db';
import { LocalDbService } from './local-db.service';

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60_000;

/** Délai avant la prochaine tentative : 5 s, 10 s, 20 s… plafonné à 15 minutes. */
export function backoffDelay(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(attempts - 1, 0), MAX_DELAY_MS);
}

export interface EnqueueOptions {
  stockDeltas?: StockDelta[];
  label?: string;
  /** Identifiant d'opération imposé (sinon UUID v4 généré sur le terminal). */
  id?: string;
}

/** File d'attente des opérations réalisées sur le terminal (écrites localement d'abord). */
@Injectable({ providedIn: 'root' })
export class OutboxService {
  private readonly local = inject(LocalDbService);
  private readonly devices = inject(DeviceService);

  async enqueue(entity: string, operation: string, payload: Record<string, unknown>,
    options: EnqueueOptions = {}): Promise<OutboxEntry> {
    const now = Date.now();
    const entry: OutboxEntry = {
      id: options.id ?? crypto.randomUUID(),
      entity,
      operation,
      payload,
      client_timestamp: new Date(now).toISOString(),
      device_id: this.devices.device()?.code ?? null,
      attempts: 0,
      status: 'pending',
      error: null,
      createdAt: now,
      nextAttemptAt: now,
      stockDeltas: options.stockDeltas ?? [],
      label: options.label ?? `${entity}.${operation}`,
    };
    await this.local.db.outbox.add(entry);
    return entry;
  }

  /** Opérations à envoyer maintenant (dans l'ordre de création, pour respecter les dépendances). */
  async due(limit = 50, now = Date.now()): Promise<OutboxEntry[]> {
    const entries = await this.local.db.outbox.orderBy('createdAt').toArray();
    return entries.filter((e) => e.status !== 'error' && e.nextAttemptAt <= now).slice(0, limit);
  }

  async all(): Promise<OutboxEntry[]> {
    return this.local.db.outbox.orderBy('createdAt').toArray();
  }

  async acknowledge(ids: string[]): Promise<void> {
    await this.local.db.outbox.bulkDelete(ids);
  }

  /** Échec réseau : nouvel essai plus tard (backoff exponentiel). */
  async postpone(ids: string[], error: string, now = Date.now()): Promise<void> {
    await this.local.db.transaction('rw', this.local.db.outbox, async () => {
      for (const id of ids) {
        const entry = await this.local.db.outbox.get(id);
        if (entry) {
          const attempts = entry.attempts + 1;
          await this.local.db.outbox.update(id, {
            attempts,
            status: 'retry',
            error,
            nextAttemptAt: now + backoffDelay(attempts),
          });
        }
      }
    });
  }

  /** Refus définitif du serveur (erreur métier ou conflit) : visible dans la file, à traiter par l'utilisateur. */
  async reject(id: string, error: string): Promise<void> {
    const entry = await this.local.db.outbox.get(id);
    if (entry) {
      await this.local.db.outbox.update(id, { status: 'error', error, attempts: entry.attempts + 1 });
    }
  }

  /**
   * Relance une opération refusée. Le serveur mémorise le résultat de chaque identifiant
   * (idempotence) : la relance reçoit donc un nouvel identifiant.
   */
  async retry(id: string): Promise<void> {
    const entry = await this.local.db.outbox.get(id);
    if (!entry) {
      return;
    }
    await this.local.db.transaction('rw', this.local.db.outbox, async () => {
      await this.local.db.outbox.delete(id);
      await this.local.db.outbox.add({ ...entry, id: crypto.randomUUID(), status: 'pending', error: null,
        attempts: 0, nextAttemptAt: Date.now() });
    });
  }

  async discard(id: string): Promise<void> {
    await this.local.db.outbox.delete(id);
  }

  async counts(): Promise<{ pending: number; errors: number }> {
    const entries = await this.local.db.outbox.toArray();
    return {
      pending: entries.filter((e) => e.status !== 'error').length,
      errors: entries.filter((e) => e.status === 'error').length,
    };
  }
}
