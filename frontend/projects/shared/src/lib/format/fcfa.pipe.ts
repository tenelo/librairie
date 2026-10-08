import { Pipe, PipeTransform } from '@angular/core';

const formatter = new Intl.NumberFormat('fr-CI', { maximumFractionDigits: 0, minimumFractionDigits: 0 });

/** Formate un montant en francs CFA, sans décimales : 12500 → « 12 500 FCFA ». */
export function formatFcfa(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  const amount = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(amount)) {
    return '';
  }
  // Intl utilise une espace fine insécable comme séparateur de milliers en français.
  return `${formatter.format(Math.round(amount))} FCFA`;
}

@Pipe({ name: 'fcfa' })
export class FcfaPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    return formatFcfa(value);
  }
}
