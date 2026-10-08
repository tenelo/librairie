import { computeZ } from './cash-register.service';
import { LocalSale } from './pos.service';

function sale(number: string, total: number, payments: { method: string; label: string; amount: number }[],
  change: number): LocalSale {
  return {
    id: number, createdAt: 0, receipt_number: number, cash_session: 's', sold_at: '', total,
    payload: { payments: payments.map((p) => ({ method: p.method, amount: p.amount })) },
    display: { cashier: '', device: 'C01', customer: null, lines: [], payments, subtotal: total, discountTotal: 0, change,
      loyaltyPoints: 0 },
  };
}

describe('rapport Z local (même formule que le serveur)', () => {
  it('calcule les espèces attendues', () => {
    const z = computeZ({ id: 's', depot: 'mag', opened_at: '', opening_float: 20000, opened_by: 'Aya' }, [
      sale('C01-20261008-0002', 400, [{ method: 'MTN_MOMO', label: 'MTN MoMo', amount: 400 }], 0),
      sale('C01-20261008-0001', 1200, [{ method: 'CASH', label: 'Espèces', amount: 2000 }], 800),
    ], 0, [{ kind: 'OUT', amount: 1000 }]);
    expect(z.expectedCash).toBe(20200);
    expect(z.salesCount).toBe(2);
    expect(z.salesTotal).toBe(1600);
    expect(z.firstReceipt).toBe('C01-20261008-0001');
    expect(z.byMethod).toEqual([{ label: 'MTN MoMo', total: 400 }, { label: 'Espèces', total: 2000 }]);
  });
});
