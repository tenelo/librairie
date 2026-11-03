import { ArticleLookup, Category } from '@librairie/shared';

import { flattenCategories } from './categories.page';
import { expandLabels } from './labels.page';

function category(id: string, name: string, parent: string | null, sort_order = 0): Category {
  return { id, name, parent, sort_order, path: name, is_active: true, article_count: 0 };
}

function article(id: string, barcode: string | null): ArticleLookup {
  return { id, code: `ART-${id}`, name: `Article ${id}`, type: 'SIMPLE', retail_price: 400, avg_cost: 250,
    is_active: true, barcode };
}

describe('catalogue : utilitaires des écrans', () => {
  it('aplatit l’arbre des catégories dans l’ordre (parents, puis enfants triés)', () => {
    const nodes = flattenCategories([
      category('e', 'Écriture', null, 20),
      category('c', 'Cahiers', null, 10),
      category('gc', 'Grands cahiers', 'c', 20),
      category('pc', 'Petits cahiers', 'c', 10),
      category('st', 'Stylos', 'e'),
    ]);
    expect(nodes.map((n) => `${n.depth}:${n.category.name}`)).toEqual([
      '0:Cahiers',
      '1:Petits cahiers',
      '1:Grands cahiers',
      '0:Écriture',
      '1:Stylos',
    ]);
  });

  it('développe les étiquettes selon le nombre d’exemplaires', () => {
    const labels = expandLabels([
      { article: article('1', '4006381333931'), copies: 3 },
      { article: article('2', null), copies: 1 },
      { article: article('3', null), copies: 0 },
    ]);
    expect(labels.length).toBe(4);
    expect(new Set(labels.map((l) => l.key)).size).toBe(4);
    expect(labels[3]).toEqual(jasmine.objectContaining({ code: 'ART-2', barcode: null, price: 400 }));
  });
});
