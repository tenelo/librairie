import { computeZ } from '../sales/cash-register.service';

describe('tontine scolaire dans la caisse', () => {
  it('ajoute les versements en espèces et retire les remboursements', () => {
    const z = computeZ({ id: 's', depot: 'mag', opened_at: '', opening_float: 10000, opened_by: 'Aya' }, [], 0, [
      { kind: 'TONTINE', amount: 2500 },
      { kind: 'TONTINE', amount: 1000 },
      { kind: 'TONTINE', amount: -500 },
      { kind: 'CLOSE', amount: 99999 },
    ]);
    expect(z.tontineCash).toBe(3000);
    expect(z.expectedCash).toBe(13000);
  });
});
