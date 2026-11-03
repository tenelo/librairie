/**
 * Codes-barres EAN-13 : clé de contrôle et dessin des barres en SVG (impression d'étiquettes
 * sans bibliothèque externe, donc disponible hors connexion).
 */

const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G_CODES = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R_CODES = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
/** Parité (L/G) des 6 chiffres de gauche, selon le premier chiffre. */
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13CheckDigit(first12: string): string {
  if (!/^\d{12}$/.test(first12)) {
    throw new Error('Il faut exactement 12 chiffres.');
  }
  const total = [...first12].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0);
  return String((10 - (total % 10)) % 10);
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];
}

/** Motif binaire des 95 modules (1 = barre noire). */
export function ean13Pattern(code: string): string {
  if (!isValidEan13(code)) {
    throw new Error(`${code} n'est pas un EAN-13 valide.`);
  }
  const parity = PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    const digit = Number(code[i]);
    bits += parity[i - 1] === 'L' ? L_CODES[digit] : G_CODES[digit];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) {
    bits += R_CODES[Number(code[i])];
  }
  return bits + '101';
}

export interface BarRect {
  x: number;
  width: number;
  guard: boolean;
}

/** Rectangles des barres (en modules), barres de garde distinguées pour les prolonger. */
export function ean13Bars(code: string): BarRect[] {
  const bits = ean13Pattern(code);
  const guards = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  const bars: BarRect[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      const start = i;
      while (i < bits.length && bits[i] === '1') {
        i++;
      }
      bars.push({ x: start, width: i - start, guard: guards.has(start) });
    } else {
      i++;
    }
  }
  return bars;
}
