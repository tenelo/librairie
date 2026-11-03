import { Injectable, InjectionToken, inject } from '@angular/core';

import { LibrairieDb, MIRROR_TABLES, MirrorTable, SyncedRow } from './local-db';

/** Nom de la base IndexedDB (remplacé dans les tests pour isoler chaque cas). */
export const LOCAL_DB_NAME = new InjectionToken<string>('LOCAL_DB_NAME', {
  providedIn: 'root',
  factory: () => 'librairie-backoffice',
});

/** Accès à la base locale et lecture des données nécessaires hors connexion. */
@Injectable({ providedIn: 'root' })
export class LocalDbService {
  readonly db = new LibrairieDb(inject(LOCAL_DB_NAME));

  async getMeta<T>(key: string, fallback: T): Promise<T> {
    const entry = await this.db.meta.get(key);
    return (entry?.value as T) ?? fallback;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  /**
   * Applique un lot reçu de `sync/pull` : insertion/mise à jour des lignes, suppression des lignes
   * supprimées logiquement côté serveur. Les entités inconnues de cette version sont ignorées.
   */
  async applyChanges(changes: Record<string, SyncedRow[]>): Promise<number> {
    let applied = 0;
    const tables = Object.keys(changes).filter((name): name is MirrorTable =>
      (MIRROR_TABLES as readonly string[]).includes(name),
    );
    if (!tables.length) {
      return 0; // IndexedDB refuse une transaction sans table.
    }
    await this.db.transaction('rw', tables.map((name) => this.db.mirror(name)), async () => {
      for (const name of tables) {
        const rows = changes[name];
        const table = this.db.mirror(name);
        await table.bulkPut(rows.filter((row) => !row.is_deleted));
        await table.bulkDelete(rows.filter((row) => row.is_deleted).map((row) => row.id));
        applied += rows.length;
      }
    });
    return applied;
  }

  async counts(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const name of MIRROR_TABLES) {
      result[name] = await this.db.mirror(name).count();
    }
    return result;
  }

  /** Vide les tables miroirs et le curseur (l'outbox et les profils sont conservés). */
  async resetMirrors(): Promise<void> {
    await this.db.transaction('rw', [...MIRROR_TABLES.map((name) => this.db.mirror(name)), this.db.meta], async () => {
      for (const name of MIRROR_TABLES) {
        await this.db.mirror(name).clear();
      }
      await this.db.meta.delete('cursor');
    });
  }

  /**
   * Stock disponible affiché sur le terminal = dernier stock synchronisé (physique − réservé)
   * + mouvements locaux pas encore acceptés par le serveur (opérations en erreur exclues).
   */
  async availableStock(article: string, depot?: string): Promise<number> {
    const levels = await this.db.stock_levels.where('article').equals(article).toArray();
    const synced = levels
      .filter((level) => !depot || level['depot'] === depot)
      .reduce((sum, level) => sum + Number(level['quantity'] ?? 0) - Number(level['reserved'] ?? 0), 0);
    const pending = await this.db.outbox.where('status').anyOf('pending', 'retry').toArray();
    const local = pending
      .flatMap((entry) => entry.stockDeltas)
      .filter((delta) => delta.article === article && (!depot || delta.depot === depot))
      .reduce((sum, delta) => sum + delta.quantity, 0);
    return synced + local;
  }

  /** Fonction `article -> disponible` pour les calculs de kits (mêmes règles que le serveur). */
  async stockLookup(depot?: string): Promise<(article: string) => number> {
    const levels = depot
      ? await this.db.stock_levels.where('depot').equals(depot).toArray()
      : await this.db.stock_levels.toArray();
    const totals = new Map<string, number>();
    for (const level of levels) {
      const id = String(level['article']);
      totals.set(id, (totals.get(id) ?? 0) + Number(level['quantity'] ?? 0) - Number(level['reserved'] ?? 0));
    }
    const pending = await this.db.outbox.where('status').anyOf('pending', 'retry').toArray();
    for (const delta of pending.flatMap((entry) => entry.stockDeltas)) {
      if (!depot || delta.depot === depot) {
        totals.set(delta.article, (totals.get(delta.article) ?? 0) + delta.quantity);
      }
    }
    return (article: string) => totals.get(article) ?? 0;
  }
}
