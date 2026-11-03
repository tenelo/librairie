import { PricedArticle } from '@librairie/shared';

import { LibraryPrice, withLibraryPrice } from './pos.page';

describe('prix de la librairie à la caisse', () => {
  const cahier: PricedArticle = {
    id: 'a1', code: 'ART-1', name: 'Cahier 200 pages', type: 'SIMPLE', retail_price: 500, wholesale_price: 450,
    wholesale_min_qty: 10, avg_cost: 300,
  };

  it('garde le prix du catalogue sans prix propre', () => {
    expect(withLibraryPrice(cahier, new Map())).toEqual(cahier);
  });

  it('applique le prix de détail de la librairie', () => {
    const prices = new Map<string, LibraryPrice>([['a1', { retail: 550, wholesale: null }]]);
    const priced = withLibraryPrice(cahier, prices);
    expect(priced.retail_price).toBe(550);
    expect(priced.wholesale_price).toBe(450);
  });

  it('applique aussi son prix de gros quand elle en a un', () => {
    const prices = new Map<string, LibraryPrice>([['a1', { retail: 550, wholesale: 480 }]]);
    expect(withLibraryPrice(cahier, prices).wholesale_price).toBe(480);
  });
});
