import Dexie, { Table } from 'dexie';

import { StoredSession } from '../models/auth.models';

/** Ligne générique reçue par `sync/pull` (tables miroirs du serveur). */
export interface SyncedRow {
  id: string;
  sync_version: number;
  is_deleted: boolean;
  [key: string]: unknown;
}

export interface StockDelta {
  article: string;
  depot: string;
  quantity: number;
}

export type OutboxStatus = 'pending' | 'retry' | 'error';

/** Opération réalisée sur le terminal, en attente d'envoi au serveur. */
export interface OutboxEntry {
  id: string;
  entity: string;
  operation: string;
  payload: Record<string, unknown>;
  client_timestamp: string;
  device_id: string | null;
  attempts: number;
  status: OutboxStatus;
  error: string | null;
  createdAt: number;
  nextAttemptAt: number;
  /** Variations de stock induites, ajoutées au stock affiché tant que l'opération n'est pas synchronisée. */
  stockDeltas: StockDelta[];
  /** Libellé lisible dans l'écran « File de synchronisation ». */
  label: string;
}

/** Profil d'un utilisateur ayant ouvert une session sur ce terminal (reprise hors ligne par PIN). */
export interface OfflineUser {
  id: string;
  username: string;
  fullName: string;
  roleLabel: string;
  session: StoredSession;
  pinHash: string | null;
  pinSalt: string | null;
  lastOnlineAuthAt: string;
  offlineMaxHours: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** Tables miroirs alimentées par `sync/pull` (même nom que les entités du serveur). */
export const MIRROR_TABLES = [
  'articles',
  'barcodes',
  'categories',
  'brands',
  'units',
  'kits',
  'kit_components',
  'levels',
  'school_years',
  'schools',
  'depots',
  'stock_levels',
  'settings',
  'customers',
  'payment_methods',
  'online_orders',
  'cash_sessions',
  'suppliers',
  'purchase_orders',
] as const;
export type MirrorTable = (typeof MIRROR_TABLES)[number];

/**
 * Base locale IndexedDB du backoffice (Dexie). Les données métier y sont lues hors connexion ;
 * l'outbox conserve les opérations jusqu'à leur acceptation par le serveur, y compris après
 * une mise à jour de l'application ou un redémarrage du terminal.
 */
export class LibrairieDb extends Dexie {
  articles!: Table<SyncedRow, string>;
  barcodes!: Table<SyncedRow, string>;
  categories!: Table<SyncedRow, string>;
  brands!: Table<SyncedRow, string>;
  units!: Table<SyncedRow, string>;
  kits!: Table<SyncedRow, string>;
  kit_components!: Table<SyncedRow, string>;
  levels!: Table<SyncedRow, string>;
  school_years!: Table<SyncedRow, string>;
  schools!: Table<SyncedRow, string>;
  depots!: Table<SyncedRow, string>;
  stock_levels!: Table<SyncedRow, string>;
  settings!: Table<SyncedRow, string>;
  customers!: Table<SyncedRow, string>;
  payment_methods!: Table<SyncedRow, string>;
  online_orders!: Table<SyncedRow, string>;
  cash_sessions!: Table<SyncedRow, string>;
  suppliers!: Table<SyncedRow, string>;
  purchase_orders!: Table<SyncedRow, string>;
  outbox!: Table<OutboxEntry, string>;
  users!: Table<OfflineUser, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'librairie-backoffice') {
    super(name);
    this.version(1).stores({
      articles: 'id, code, name, type, category, is_active',
      barcodes: 'id, &code, article',
      categories: 'id, parent',
      brands: 'id',
      units: 'id',
      kits: 'id, article, level, school',
      kit_components: 'id, kit, article',
      levels: 'id, code',
      school_years: 'id',
      schools: 'id',
      depots: 'id, code',
      stock_levels: 'id, [article+depot], article, depot',
      settings: 'id',
      customers: 'id, phone, name',
      payment_methods: 'id, code',
      online_orders: 'id, number, status',
      cash_sessions: 'id, device, status',
      outbox: 'id, status, entity, createdAt, nextAttemptAt',
      users: 'id, &username',
      meta: 'key',
    });
    this.version(2).stores({
      suppliers: 'id, name',
      purchase_orders: 'id, number, supplier, status',
    });
  }

  mirror(name: MirrorTable): Table<SyncedRow, string> {
    return this[name];
  }
}
