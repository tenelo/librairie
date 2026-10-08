import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';

import { AuthService } from '../auth/auth.service';
import { DeviceService } from '../auth/device.service';
import { makeProfile, storeSession, testProviders } from '../testing/test-helpers';
import { LOCAL_DB_NAME, LocalDbService } from './local-db.service';
import { OfflineAuthService, hashPin, offlineWindowOpen } from './offline-auth.service';
import { OutboxService, backoffDelay } from './outbox.service';
import { SyncEngineService } from './sync-engine.service';

let dbName = '';

function setup() {
  dbName = `test-${crypto.randomUUID()}`;
  TestBed.configureTestingModule({ providers: [...testProviders(), { provide: LOCAL_DB_NAME, useValue: dbName }] });
  return {
    local: TestBed.inject(LocalDbService),
    outbox: TestBed.inject(OutboxService),
  };
}

afterEach(async () => {
  TestBed.inject(LocalDbService).db.close();
  await Dexie.delete(dbName);
  localStorage.clear();
});

describe('outbox', () => {
  beforeEach(() => localStorage.clear());

  it('enregistre localement avec un UUID, la date client et le terminal', async () => {
    const { outbox } = setup();
    TestBed.inject(DeviceService).register({ code: 'c02', name: 'Caisse 2' });
    const entry = await outbox.enqueue('stock_adjustment', 'create', { quantity: 1 });
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.device_id).toBe('C02');
    expect(entry.status).toBe('pending');
    expect((await outbox.due()).map((e) => e.id)).toEqual([entry.id]);
  });

  it('reporte avec un backoff exponentiel plafonné', async () => {
    expect(backoffDelay(1)).toBe(5000);
    expect(backoffDelay(3)).toBe(20000);
    expect(backoffDelay(30)).toBe(15 * 60_000);
    const { outbox } = setup();
    const entry = await outbox.enqueue('x', 'create', {});
    await outbox.postpone([entry.id], 'Erreur réseau', 1000);
    expect(await outbox.due(50, 1000 + 4999)).toEqual([]);
    expect((await outbox.due(50, 1000 + 5000)).length).toBe(1);
  });

  it('une opération refusée sort de la file et se relance sous un nouvel identifiant', async () => {
    const { outbox } = setup();
    const entry = await outbox.enqueue('x', 'create', { a: 1 });
    await outbox.reject(entry.id, 'Motif obligatoire');
    expect(await outbox.due()).toEqual([]);
    expect(await outbox.counts()).toEqual({ pending: 0, errors: 1 });
    await outbox.retry(entry.id);
    const [retried] = await outbox.all();
    expect(retried.id).not.toBe(entry.id);
    expect(retried.status).toBe('pending');
    expect(retried.payload).toEqual({ a: 1 });
  });
});

describe('base locale', () => {
  beforeEach(() => localStorage.clear());

  it('applique les modifications et les suppressions reçues du serveur', async () => {
    const { local } = setup();
    await local.applyChanges({
      articles: [
        { id: 'a', sync_version: 1, is_deleted: false, name: 'Cahier' },
        { id: 'b', sync_version: 2, is_deleted: false, name: 'Stylo' },
      ],
      inconnue: [{ id: 'x', sync_version: 3, is_deleted: false }],
    });
    await local.applyChanges({ articles: [{ id: 'b', sync_version: 4, is_deleted: true }] });
    expect(await local.applyChanges({})).toBe(0);
    expect((await local.db.articles.toArray()).map((a) => a.id)).toEqual(['a']);
  });

  it('stock affiché = stock synchronisé + mouvements locaux non envoyés', async () => {
    const { local, outbox } = setup();
    await local.applyChanges({ stock_levels: [
      { id: 'l1', sync_version: 1, is_deleted: false, article: 'a', depot: 'mag', quantity: 10, reserved: 2 },
      { id: 'l2', sync_version: 2, is_deleted: false, article: 'a', depot: 'res', quantity: 5, reserved: 0 },
    ] });
    await outbox.enqueue('sale', 'create', {}, { stockDeltas: [{ article: 'a', depot: 'mag', quantity: -3 }] });
    const refused = await outbox.enqueue('sale', 'create', {}, { stockDeltas: [{ article: 'a', depot: 'mag', quantity: -100 }] });
    await outbox.reject(refused.id, 'refusée');
    expect(await local.availableStock('a', 'mag')).toBe(5);
    expect(await local.availableStock('a')).toBe(10);
    expect((await local.stockLookup('mag'))('a')).toBe(5);
  });
});

describe('PIN hors connexion', () => {
  beforeEach(() => localStorage.clear());

  it('hache le PIN avec un sel et vérifie la fenêtre hors ligne', async () => {
    const first = await hashPin('1234');
    const again = await hashPin('1234', first.salt);
    expect(again.hash).toBe(first.hash);
    expect((await hashPin('1234')).hash).not.toBe(first.hash);
    const now = Date.parse('2026-10-08T12:00:00Z');
    expect(offlineWindowOpen({ lastOnlineAuthAt: '2026-10-06T13:00:00Z', offlineMaxHours: 72 }, now)).toBeTrue();
    expect(offlineWindowOpen({ lastOnlineAuthAt: '2026-10-05T11:00:00Z', offlineMaxHours: 72 }, now)).toBeFalse();
  });

  it('un caissier reprend la main par PIN sur le terminal', async () => {
    storeSession({ user: makeProfile({ id: 'u1', username: 'caisse1', has_pin: true }) });
    setup();
    const offlineAuth = TestBed.inject(OfflineAuthService);
    const auth = TestBed.inject(AuthService);
    await offlineAuth.remember(auth.session()!);
    await offlineAuth.setLocalPin('u1', '4321');
    auth.clearSession();
    expect(auth.isAuthenticated()).toBeFalse();

    expect((await offlineAuth.unlockableUsers()).map((u) => u.username)).toEqual(['caisse1']);
    expect(await offlineAuth.unlock('u1', '0000')).toBeFalse();
    expect(await offlineAuth.unlock('u1', '4321')).toBeTrue();
    expect(auth.user()?.username).toBe('caisse1');
    const later = Date.now() + 73 * 3_600_000;
    expect(await offlineAuth.unlock('u1', '4321', later)).toBeFalse();
  });
});

describe('moteur de synchronisation', () => {
  beforeEach(() => localStorage.clear());

  it('envoie l’outbox, retire les opérations acceptées et garde les refus', async () => {
    storeSession();
    const { outbox, local } = setup();
    const http = TestBed.inject(HttpTestingController);
    const engine = TestBed.inject(SyncEngineService);
    const ok = await outbox.enqueue('a', 'create', {});
    const ko = await outbox.enqueue('b', 'create', {});

    const done = engine.pushAll();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const request = http.expectOne('/api/sync/push/');
    expect(request.request.body.operations.map((o: { id: string }) => o.id)).toEqual([ok.id, ko.id]);
    request.flush({ results: [{ id: ok.id, status: 'ok' }, { id: ko.id, status: 'error', error: 'Motif obligatoire' }] });
    await done;
    const remaining = await local.db.outbox.toArray();
    expect(remaining.map((e) => [e.id, e.status, e.error])).toEqual([[ko.id, 'error', 'Motif obligatoire']]);
  });

  it('réseau coupé pendant l’envoi : nouvel essai programmé', async () => {
    storeSession();
    const { outbox } = setup();
    const http = TestBed.inject(HttpTestingController);
    const engine = TestBed.inject(SyncEngineService);
    await outbox.enqueue('a', 'create', {});
    const done = engine.pushAll().catch(() => 'échec');
    await new Promise((resolve) => setTimeout(resolve, 20));
    http.expectOne('/api/sync/push/').error(new ProgressEvent('error'), { status: 0 });
    expect(await done).toBe('échec');
    const [entry] = await outbox.all();
    expect(entry.status).toBe('retry');
    expect(entry.attempts).toBe(1);
  });

  it('descend les données page par page et mémorise le curseur', async () => {
    storeSession();
    const { local } = setup();
    const http = TestBed.inject(HttpTestingController);
    const engine = TestBed.inject(SyncEngineService);
    const done = engine.pullAll();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const first = http.expectOne((r) => r.url === '/api/sync/pull/' && r.params.get('since') === '0');
    first.flush({ cursor: 10, has_more: true, changes: { articles: [{ id: 'a', sync_version: 10, is_deleted: false }] } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = http.expectOne((r) => r.url === '/api/sync/pull/' && r.params.get('since') === '10');
    second.flush({ cursor: 12, has_more: false, changes: { depots: [{ id: 'd', sync_version: 12, is_deleted: false }] } });
    await done;
    expect(await local.getMeta('cursor', 0)).toBe(12);
    expect(await local.db.articles.count()).toBe(1);
    expect(await local.db.depots.count()).toBe(1);
  });
});
