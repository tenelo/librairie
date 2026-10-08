/**
 * Calculs en FCFA (entiers), identiques à `apps/core/money.py` côté serveur :
 * les prix calculés hors connexion doivent tomber sur les mêmes valeurs qu'en ligne.
 */

/** Arrondi « demi au supérieur » (en valeur absolue), comme ROUND_HALF_UP en Python. */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  // Correction des erreurs binaires (ex. 1069.4999999 au lieu de 1069.5).
  return sign * Math.floor(Math.abs(value) + 0.5 + 1e-9);
}

/** Arrondit au multiple de `step` le plus proche (5 FCFA par défaut dans les paramètres). */
export function roundFcfa(value: number, step = 1): number {
  const unit = Math.max(Math.trunc(step) || 1, 1);
  return roundHalfUp(value / unit) * unit;
}

/** Applique une remise en pourcentage (sans arrondi). */
export function applyDiscount(amount: number, percent: number | string | null | undefined): number {
  return (amount * (100 - Number(percent ?? 0))) / 100;
}
