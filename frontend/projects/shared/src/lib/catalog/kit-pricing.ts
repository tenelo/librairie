import { applyDiscount, roundFcfa, roundHalfUp } from '../format/money';
import { KitPricingMode } from '../models/catalog.models';

/**
 * Réplique TypeScript de `apps/catalog/services.py` (compute_kit_pricing et customize_kit).
 * Utilisée pour l'aperçu instantané dans l'éditeur de kits et, en phase caisse, pour
 * calculer hors connexion le prix d'un kit personnalisé (retrait / substitution).
 */
export interface PricedComponent {
  id: string;
  unitPrice: number;
  unitCost: number;
  quantity: number;
  substitutes?: { id: string; unitPrice: number }[];
}

export interface KitPricingInput {
  pricingMode: KitPricingMode;
  discountPercent: number | string;
  fixedPrice: number;
  components: PricedComponent[];
  rounding: number;
}

export interface KitPricingResult {
  componentsTotal: number;
  computedPrice: number;
  price: number;
  cost: number;
  margin: number;
  marginRate: number | null;
}

export function computeKitPricing(input: KitPricingInput): KitPricingResult {
  const componentsTotal = input.components.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0);
  const cost = input.components.reduce((sum, c) => sum + c.unitCost * c.quantity, 0);
  const computedPrice = roundFcfa(applyDiscount(componentsTotal, input.discountPercent), input.rounding);
  const price = input.pricingMode === 'COMPUTED' ? computedPrice : input.fixedPrice;
  const margin = price - cost;
  const marginRate = price ? roundHalfUp((margin * 1000) / price) / 10 : null;
  return { componentsTotal, computedPrice, price, cost, margin, marginRate };
}

export interface KitAdjustment {
  action: 'REMOVED' | 'SUBSTITUTED';
  component: string;
  substitute?: string;
  priceDelta: number;
}

export interface KitCustomizationResult {
  basePrice: number;
  price: number;
  adjustments: KitAdjustment[];
}

/**
 * Prix d'un kit dont le client retire ou remplace des composants.
 * Chaque ajustement est valorisé au prix détail du composant, remise kit appliquée.
 */
export function customizeKit(
  input: KitPricingInput,
  removed: readonly string[],
  substitutions: Readonly<Record<string, string>>,
): KitCustomizationResult {
  const basePrice = computeKitPricing(input).price;
  let delta = 0;
  const adjustments: KitAdjustment[] = [];
  for (const component of input.components) {
    if (removed.includes(component.id)) {
      const value = applyDiscount(component.unitPrice * component.quantity, input.discountPercent);
      delta -= value;
      adjustments.push({ action: 'REMOVED', component: component.id, priceDelta: -roundHalfUp(value) });
      continue;
    }
    const substituteId = substitutions[component.id];
    if (substituteId) {
      const substitute = component.substitutes?.find((s) => s.id === substituteId);
      if (!substitute) {
        throw new Error('Équivalent non autorisé pour ce composant.');
      }
      const value = applyDiscount((substitute.unitPrice - component.unitPrice) * component.quantity, input.discountPercent);
      delta += value;
      adjustments.push({
        action: 'SUBSTITUTED',
        component: component.id,
        substitute: substituteId,
        priceDelta: roundHalfUp(value),
      });
    }
  }
  return { basePrice, price: Math.max(roundFcfa(basePrice + delta, input.rounding), 0), adjustments };
}
