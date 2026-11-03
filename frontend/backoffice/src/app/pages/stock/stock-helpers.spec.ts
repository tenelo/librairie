import { ArticleLookup, Depot, PurchaseOrder, defaultDepotId } from '@librairie/shared';

import { linesFromOrder } from '../purchasing/receipt-form.page';
import { SuggestionRow, groupBySupplier } from '../purchasing/suggestions.page';
import { EditableLine, addOrIncrement, linesTotal } from './lines-editor.component';

function article(id: string, cost = 250): ArticleLookup {
  return { id, code: `ART-${id}`, name: `Article ${id}`, type: 'SIMPLE', retail_price: 400, avg_cost: cost,
    is_active: true, barcode: null };
}

function depot(id: string, extra: Partial<Depot> = {}): Depot {
  return { id, code: id.toUpperCase(), name: id, kind: 'BOUTIQUE', kind_label: '', address: '', is_pickup_point: false,
    is_default: false, is_active: true, ...extra };
}

describe('stock et achats : utilitaires des écrans', () => {
  it('ajoute un article puis incrémente sa quantité à chaque scan', () => {
    let lines: EditableLine[] = [];
    lines = addOrIncrement(lines, article('a'), 250);
    lines = addOrIncrement(lines, article('a'), 250);
    lines = addOrIncrement(lines, article('b', 80), 80);
    expect(lines.map((l) => [l.article, l.quantity])).toEqual([['a', 2], ['b', 1]]);
    expect(linesTotal(lines)).toBe(2 * 250 + 80);
  });

  it('un scan sur une réception de commande incrémente la ligne commandée', () => {
    const lines: EditableLine[] = [{ article: 'a', code: 'A', name: 'A', quantity: 3, unitCost: 250, orderLine: 'l1',
      expected: 10 }];
    const next = addOrIncrement(lines, article('a'), 999);
    expect(next.length).toBe(1);
    expect(next[0]).toEqual(jasmine.objectContaining({ quantity: 4, orderLine: 'l1', unitCost: 250 }));
  });

  it('préremplit une réception avec les reliquats du bon de commande', () => {
    const order = { lines: [
      { id: 'l1', article: 'a', article_code: 'A', article_name: 'Cahier', quantity: 100, unit_cost: 250,
        received_quantity: 60, remaining: 40 },
      { id: 'l2', article: 'b', article_code: 'B', article_name: 'Stylo', quantity: 50, unit_cost: 80,
        received_quantity: 50, remaining: 0 },
    ] } as PurchaseOrder;
    expect(linesFromOrder(order)).toEqual([
      { article: 'a', code: 'A', name: 'Cahier', quantity: 40, expected: 40, unitCost: 250, orderLine: 'l1' },
    ]);
  });

  it('regroupe les suggestions sélectionnées par fournisseur', () => {
    const row = (articleId: string, supplierId: string | null, selected = true, quantity = 10) =>
      ({ article: articleId, supplierId, selected, quantity }) as SuggestionRow;
    const groups = groupBySupplier([row('a', 's1'), row('b', 's2'), row('c', 's1'), row('d', null), row('e', 's1', false),
      row('f', 's2', true, 0)]);
    expect([...groups.keys()]).toEqual(['s1', 's2']);
    expect(groups.get('s1')?.map((r) => r.article)).toEqual(['a', 'c']);
    expect(groups.get('s2')?.length).toBe(1);
  });

  it('choisit le dépôt du terminal, sinon le dépôt par défaut', () => {
    const depots = [depot('res'), depot('mag', { is_default: true }), depot('old', { is_active: false })];
    expect(defaultDepotId(depots, 'res')).toBe('res');
    expect(defaultDepotId(depots, 'old')).toBe('mag');
    expect(defaultDepotId(depots, null)).toBe('mag');
    expect(defaultDepotId([], null)).toBeNull();
  });
});
