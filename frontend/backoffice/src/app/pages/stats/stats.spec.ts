import { chartPoints, niceTicks } from '@librairie/shared';

import { localDaySummary } from '../dashboard/activity-panel.component';
import { formatValue, formatVariation, presetRange } from './report-format';
import { parseRecipients } from './scheduled-reports.component';

describe('Statistiques', () => {
  it('formate les valeurs des rapports', () => {
    expect(formatValue(12500, 'money')).toContain('12');
    expect(formatValue(12500, 'money')).toContain('FCFA');
    expect(formatValue(12.345, 'percent')).toBe('12,3 %');
    expect(formatValue('2026-09-15', 'date')).toBe('15/09/2026');
    expect(formatValue(null, 'int')).toBe('—');
    expect(formatVariation(5)).toBe('+5 %');
    expect(formatVariation(-2.5)).toBe('-2,5 %');
    expect(formatVariation(null)).toBe('');
  });

  it('calcule les périodes prédéfinies', () => {
    const today = new Date(2026, 9, 9);
    expect(presetRange('7d', today)).toEqual({ date_from: '2026-10-03', date_to: '2026-10-09' });
    expect(presetRange('month', today).date_from).toBe('2026-10-01');
    expect(presetRange('year', today).date_from).toBe('2026-01-01');
  });

  it('prépare les graphiques', () => {
    expect(niceTicks(0, 950)).toEqual([0, 250, 500, 750, 1000]);
    expect(chartPoints([{ l: 'a', v: 1 }, { l: 'b', v: null }, { l: 'c', v: 3 }], 'l', 'v', 1))
      .toEqual([{ label: 'a', value: 1 }]);
  });

  it('lit les destinataires et résume la journée hors ligne', () => {
    expect(parseRecipients('a@b.ci; faux, c@d.com')).toEqual(['a@b.ci', 'c@d.com']);
    const now = new Date();
    const summary = localDaySummary([{ sold_at: now.toISOString(), total: 1000 },
      { sold_at: now.toISOString(), total: 500 }, { sold_at: '2020-01-01T10:00:00Z', total: 9999 }], now);
    expect(summary).toEqual({ count: 2, revenue: 1500, average: 750 });
  });
});
