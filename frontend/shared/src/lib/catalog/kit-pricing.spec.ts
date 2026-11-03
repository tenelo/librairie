import { applyDiscount, roundFcfa, roundHalfUp } from '../format/money';
import { KitPricingInput, computeKitPricing, customizeKit } from './kit-pricing';

/** Mêmes jeux de données que apps/catalog/tests/test_services.py : les deux calculs doivent coïncider. */
describe('prix des kits (réplique du serveur)', () => {
  it('arrondit comme ROUND_HALF_UP', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundFcfa(1232, 5)).toBe(1230);
    expect(roundFcfa(1233, 5)).toBe(1235);
    expect(roundFcfa(1237.5, 25)).toBe(1250);
    expect(applyDiscount(3300, '7')).toBeCloseTo(3069, 6);
  });

  const supplies = {
    cahier: { price: 400, cost: 250 },
    stylo: { price: 150, cost: 80 },
    regle: { price: 300, cost: 180 },
    compas: { price: 1500, cost: 1000 },
  };

  it('kit calculé : remise et arrondi à 5 FCFA', () => {
    const result = computeKitPricing({
      pricingMode: 'COMPUTED',
      discountPercent: '7',
      fixedPrice: 0,
      rounding: 5,
      components: [
        { id: 'c', unitPrice: supplies.cahier.price, unitCost: supplies.cahier.cost, quantity: 6 },
        { id: 's', unitPrice: supplies.stylo.price, unitCost: supplies.stylo.cost, quantity: 4 },
        { id: 'r', unitPrice: supplies.regle.price, unitCost: supplies.regle.cost, quantity: 1 },
      ],
    });
    expect(result.componentsTotal).toBe(3300);
    expect(result.computedPrice).toBe(3070);
    expect(result.price).toBe(3070);
    expect(result.cost).toBe(2000);
    expect(result.margin).toBe(1070);
    expect(result.marginRate).toBe(34.9);
  });

  it('kit à prix fixe : le prix saisi prime, le prix calculé reste indicatif', () => {
    const result = computeKitPricing({
      pricingMode: 'FIXED',
      discountPercent: 0,
      fixedPrice: 2000,
      rounding: 5,
      components: [{ id: 'c', unitPrice: 400, unitCost: 250, quantity: 6 }],
    });
    expect(result.computedPrice).toBe(2400);
    expect(result.price).toBe(2000);
    expect(result.margin).toBe(500);
  });

  describe('personnalisation à la vente', () => {
    const input: KitPricingInput = {
      pricingMode: 'COMPUTED',
      discountPercent: '10',
      fixedPrice: 0,
      rounding: 5,
      components: [
        { id: 'cahier', unitPrice: 400, unitCost: 250, quantity: 6 },
        { id: 'compas', unitPrice: 1500, unitCost: 1000, quantity: 1, substitutes: [{ id: 'luxe', unitPrice: 2500 }] },
        { id: 'regle', unitPrice: 300, unitCost: 180, quantity: 1 },
      ],
    };

    it('retire et remplace des composants avec la remise du kit', () => {
      const result = customizeKit(input, ['regle'], { compas: 'luxe' });
      expect(result.basePrice).toBe(3780);
      expect(result.price).toBe(3780 - 270 + 900);
      expect(result.adjustments).toEqual([
        { action: 'SUBSTITUTED', component: 'compas', substitute: 'luxe', priceDelta: 900 },
        { action: 'REMOVED', component: 'regle', priceDelta: -270 },
      ]);
    });

    it('refuse un équivalent non autorisé', () => {
      expect(() => customizeKit(input, [], { compas: 'inconnu' })).toThrowError();
    });

    it('ne descend jamais sous zéro', () => {
      const fixed: KitPricingInput = { ...input, pricingMode: 'FIXED', fixedPrice: 100, discountPercent: 0 };
      expect(customizeKit(fixed, ['cahier'], {}).price).toBe(0);
    });
  });
});
