import { PrepLine, Shortage, applyScan, readiness, sortByLocation } from './preparation';

const lines: PrepLine[] = [
  { id: 'l1', article: 'a1', code: 'ART-1', name: 'Cahier', quantity: 2, location: 'B2', barcodes: ['6130000000011'] },
  { id: 'l2', article: 'a2', code: 'ART-2', name: 'Stylo', quantity: 1, location: 'A1', barcodes: ['6130000000028'] },
];

describe('Préparation par scan', () => {
  it('reconnaît le code-barres, compte et bloque au-delà de la quantité', () => {
    const prepared: Record<string, number> = {};
    const first = applyScan(lines, prepared, {}, '6130000000011');
    expect(first.ok).toBeTrue();
    prepared['l1'] = 2;
    const extra = applyScan(lines, prepared, {}, '6130000000011');
    expect(extra.ok).toBeFalse();
    expect(applyScan(lines, prepared, {}, 'art-2').ok).toBeTrue();
  });

  it('refuse un article absent de la commande', () => {
    const result = applyScan(lines, {}, {}, '9999999999999');
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.error).toContain('absent de la commande');
    }
  });

  it('tient compte des ruptures déclarées pour la complétude', () => {
    const shortages: Record<string, Shortage> = { l1: { quantity: 1, substitute: null } };
    expect(readiness(lines, { l1: 1, l2: 1 }, shortages).complete).toBeTrue();
    expect(readiness(lines, { l1: 1, l2: 1 }, {}).missing).toEqual(['Cahier (1/2)']);
  });

  it('trie par emplacement', () => {
    expect(sortByLocation(lines).map((l) => l.id)).toEqual(['l2', 'l1']);
  });
});
