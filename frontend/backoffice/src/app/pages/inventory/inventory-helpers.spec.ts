import { LocalRecord, SyncedRow } from '@librairie/shared';

import { countTotals, sessionsForUser } from './counting.page';
import { VarianceLine } from './inventory-api.service';
import { filterVarianceLines } from './inventory-detail.page';

function line(partial: Partial<VarianceLine>): VarianceLine {
  return { article: 'a', code: 'C', name: 'Cahier', theoretical: 10, movements_during: 0, expected: 10,
    first_count: null, second_count: null, counted: null, variance: null, unit_cost: 100, variance_value: 0,
    needs_recount: false, ...partial };
}

describe('Inventaires : aides', () => {
  it('additionne les comptages par article et sépare le recomptage', () => {
    const counts: LocalRecord[] = [
      { id: '1', createdAt: 1, article: 'a', article_name: 'Cahier', quantity: 30, round: 1 },
      { id: '2', createdAt: 2, article: 'a', article_name: 'Cahier', quantity: 14, round: 1 },
      { id: '3', createdAt: 3, article: 'a', article_name: 'Cahier', quantity: 45, round: 2 },
      { id: '4', createdAt: 4, article: 'b', article_name: 'Ardoise', quantity: 3, round: 1 },
    ];
    const totals = countTotals(counts);
    expect(totals.map((t) => t.name)).toEqual(['Ardoise', 'Cahier']);
    expect(totals[1]).toEqual(jasmine.objectContaining({ round1: 44, round2: 45, entries: 3 }));
  });

  it('ne propose que les inventaires affectés à l’utilisateur ou sans affectation', () => {
    const sessions: SyncedRow[] = [
      { id: 's1', sync_version: 1, is_deleted: false, assignments: [] },
      { id: 's2', sync_version: 1, is_deleted: false, assignments: [{ user: 'awa' }] },
      { id: 's3', sync_version: 1, is_deleted: false, assignments: [{ user: 'koffi' }] },
    ];
    expect(sessionsForUser(sessions, 'awa').map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('filtre les lignes du rapport d’écarts', () => {
    const lines = [
      line({ article: '1', counted: 10, variance: 0 }),
      line({ article: '2', name: 'Stylo', counted: 8, variance: -2 }),
      line({ article: '3', name: 'Gomme' }),
      line({ article: '4', name: 'Règle', counted: 2, variance: -8, needs_recount: true }),
    ];
    expect(filterVarianceLines(lines, 'variance').map((l) => l.article)).toEqual(['2', '4']);
    expect(filterVarianceLines(lines, 'uncounted').map((l) => l.article)).toEqual(['3']);
    expect(filterVarianceLines(lines, 'recount').map((l) => l.article)).toEqual(['4']);
    expect(filterVarianceLines(lines, 'all', 'sty').map((l) => l.article)).toEqual(['2']);
  });
});
