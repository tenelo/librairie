import { CartLine, cartTotals, checkPayments, countDenominations, earnedPoints, lineTotal, receiptNumber, returnAmount,
  unitPrice } from './cart';
import { encodeEscPos, toPrinterText } from './printer.service';
import { ReceiptData } from './receipt.models';

function line(price: number, quantity: number, extra: Partial<CartLine> = {}): CartLine {
  return {
    id: crypto.randomUUID(), quantity, customPrice: null, discount: 0, kitAdjustments: null, description: 'Article',
    article: { id: 'a', code: 'ART-1', name: 'Article', type: 'SIMPLE', retail_price: price, wholesale_price: null,
      wholesale_min_qty: null, avg_cost: 0 },
    ...extra,
  };
}

describe('caisse : calculs du panier (mêmes règles que le serveur)', () => {
  it('applique le prix de gros au-delà du seuil', () => {
    const rame = line(3500, 9, { article: { ...line(3500, 1).article, wholesale_price: 3200, wholesale_min_qty: 10 } });
    expect(unitPrice(rame)).toEqual({ price: 3500, kind: 'RETAIL' });
    expect(unitPrice({ ...rame, quantity: 10 })).toEqual({ price: 3200, kind: 'WHOLESALE' });
  });

  it('calcule remises, total et pourcentage de remise', () => {
    const totals = cartTotals([line(1000, 2, { discount: 100 }), line(500, 1)], 200, 50);
    expect(totals.gross).toBe(2500);
    expect(totals.subtotal).toBe(2400);
    expect(totals.total).toBe(2150);
    expect(totals.discountPercent).toBeCloseTo(12, 6);
    expect(lineTotal(line(400, 3, { discount: 50 }))).toBe(1150);
  });

  it('valide les paiements : montant, monnaie sur espèces, références, crédit', () => {
    const ref = (code: string) => code === 'WAVE';
    expect(checkPayments(3500, [{ method: 'CASH', kind: 'CASH', amount: 2000 },
      { method: 'WAVE', kind: 'MOBILE_MONEY', amount: 1500, reference: 'W1' }], ref, false).valid).toBeTrue();
    const change = checkPayments(1800, [{ method: 'CASH', kind: 'CASH', amount: 5000 }], ref, false);
    expect(change.change).toBe(3200);
    expect(checkPayments(1800, [{ method: 'CASH', kind: 'CASH', amount: 1000 }], ref, false).error).toContain('Reste');
    expect(checkPayments(1000, [{ method: 'WAVE', kind: 'MOBILE_MONEY', amount: 2000, reference: 'x' }], ref, false)
      .error).toContain('espèces');
    expect(checkPayments(1000, [{ method: 'WAVE', kind: 'MOBILE_MONEY', amount: 1000 }], ref, false).error)
      .toContain('référence');
    expect(checkPayments(1000, [{ method: 'CREDIT', kind: 'CREDIT', amount: 1000 }], ref, false).error).toContain('client');
  });

  it('numérote les reçus hors ligne et calcule points, retours et comptage', () => {
    expect(receiptNumber('C02', new Date('2026-10-08T15:00:00Z'), 47)).toBe('C02-20261008-0047');
    expect(earnedPoints(4999, 2)).toBe(8);
    expect(returnAmount(2000, 5, 2, 1800, 2000)).toBe(720);
    expect(countDenominations({ 10000: 2, 100: 1, 50: 1 })).toBe(20150);
  });
});

describe('impression ESC/POS', () => {
  const receipt: ReceiptData = {
    title: 'Reçu', number: 'C01-20261008-0001', date: '2026-10-08T10:00:00Z', cashier: 'Aya', device: 'C01',
    customer: null, lines: [{ name: 'Cahier 100 pages', quantity: 2, unitPrice: 400, discount: 0, total: 800, details: [] }],
    subtotal: 800, discountTotal: 0, total: 800, payments: [{ label: 'Espèces', amount: 1000 }], change: 200,
    loyaltyPoints: null, duplicate: true, extra: [], qrValue: 'C01-20261008-0001',
    library: { name: 'Librairie Éclair', logo: null, address: '', city: 'Abidjan', phone: '', email: '',
      taxpayer_number: '', trade_register: '', receipt_header: '', receipt_footer: 'Merci !' },
  };

  it('retire les accents et produit initialisation, QR code et coupe', () => {
    expect(toPrinterText('Élève à côté')).toBe('Eleve a cote');
    const bytes = encodeEscPos(receipt, 'THERMAL_58');
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('DUPLICATA');
    expect(text).toContain('Librairie Eclair');
    expect(text).toContain('Monnaie rendue');
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(text.split('\n').every((l) => l.replace(/[\x00-\x1f]/g, '').length <= 40)).toBeTrue();
  });
});
