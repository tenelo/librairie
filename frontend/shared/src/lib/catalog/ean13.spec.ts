import { ean13Bars, ean13CheckDigit, ean13Pattern, isValidEan13 } from './ean13';

describe('EAN-13', () => {
  it('calcule la clé de contrôle (mêmes valeurs que le serveur)', () => {
    expect(ean13CheckDigit('400638133393')).toBe('1');
    expect(ean13CheckDigit('200000000001')).toBe('5');
    expect(() => ean13CheckDigit('123')).toThrowError();
  });

  it('valide un code complet', () => {
    expect(isValidEan13('4006381333931')).toBeTrue();
    expect(isValidEan13('4006381333932')).toBeFalse();
    expect(isValidEan13('ABC')).toBeFalse();
  });

  it('produit 95 modules encadrés par les gardes', () => {
    const bits = ean13Pattern('4006381333931');
    expect(bits.length).toBe(95);
    expect(bits.startsWith('101')).toBeTrue();
    expect(bits.endsWith('101')).toBeTrue();
    expect(bits.slice(45, 50)).toBe('01010');
    // Premier chiffre 4 → parité LGLLGG ; le 2e chiffre (0) est codé en L : 0001101.
    expect(bits.slice(3, 10)).toBe('0001101');
    // Le 3e chiffre (0) est codé en G : 0100111.
    expect(bits.slice(10, 17)).toBe('0100111');
    // Côté droit : dernier chiffre 1 en R : 1100110.
    expect(bits.slice(85, 92)).toBe('1100110');
  });

  it('regroupe les barres et marque les gardes', () => {
    const bars = ean13Bars('4006381333931');
    const modules = bars.reduce((sum, bar) => sum + bar.width, 0);
    expect(modules).toBe([...ean13Pattern('4006381333931')].filter((b) => b === '1').length);
    expect(bars.filter((bar) => bar.guard).length).toBe(6);
  });
});
