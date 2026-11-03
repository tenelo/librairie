import { formatFcfa } from '@librairie/shared';

import { ValueKind } from './reports-api.service';

/** Mise en forme d'une valeur de rapport selon son type (FCFA, entier, %, date…). */
export function formatValue(value: unknown, kind: ValueKind): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  switch (kind) {
    case 'money':
      return formatFcfa(Number(value));
    case 'percent':
      return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
    case 'int':
      return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
    case 'decimal':
      return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
    case 'date': {
      const [y, m, d] = String(value).slice(0, 10).split('-');
      return d ? `${d}/${m}/${y}` : String(value);
    }
    default:
      return String(value);
  }
}

/** Libellé de variation par rapport à la période précédente (« +12,5 % »). */
export function formatVariation(variation: number | null | undefined): string {
  if (variation === null || variation === undefined) {
    return '';
  }
  const sign = variation > 0 ? '+' : '';
  return `${sign}${variation.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

/** Plage de dates prédéfinie, en dates locales ISO (AAAA-MM-JJ). */
export function presetRange(preset: 'today' | '7d' | '30d' | 'month' | 'year', today = new Date()):
  { date_from: string; date_to: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = new Date(today);
  if (preset === '7d') {
    start.setDate(today.getDate() - 6);
  } else if (preset === '30d') {
    start.setDate(today.getDate() - 29);
  } else if (preset === 'month') {
    start.setDate(1);
  } else if (preset === 'year') {
    start.setMonth(0, 1);
  }
  return { date_from: iso(start), date_to: iso(today) };
}
