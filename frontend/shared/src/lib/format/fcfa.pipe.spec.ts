import { FcfaPipe, formatFcfa } from './fcfa.pipe';

/** Normalise les espaces insécables (fines ou non) produites par Intl pour comparer simplement. */
function plain(value: string): string {
  return value.replace(/[  ]/g, ' ');
}

describe('formatFcfa', () => {
  it('formate sans décimales avec séparateur de milliers', () => {
    expect(plain(formatFcfa(12500))).toBe('12 500 FCFA');
    expect(plain(formatFcfa(1250000))).toBe('1 250 000 FCFA');
  });

  it('arrondit les montants (le FCFA n’a pas de décimales)', () => {
    expect(plain(formatFcfa(999.6))).toBe('1 000 FCFA');
    expect(plain(formatFcfa('2500.4'))).toBe('2 500 FCFA');
  });

  it('gère zéro, négatifs et valeurs vides', () => {
    expect(plain(formatFcfa(0))).toBe('0 FCFA');
    expect(plain(formatFcfa(-1500))).toContain('1 500 FCFA');
    expect(formatFcfa(null)).toBe('');
    expect(formatFcfa(undefined)).toBe('');
    expect(formatFcfa('abc')).toBe('');
  });

  it('est exposé comme pipe', () => {
    expect(plain(new FcfaPipe().transform(300))).toBe('300 FCFA');
  });
});
