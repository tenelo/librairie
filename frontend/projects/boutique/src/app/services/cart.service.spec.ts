import { TestBed } from '@angular/core/testing';

import { depositAmount } from '../pages/orders/cart.page';
import { stepIndex } from '../pages/orders/order.page';
import { CartService, clampQuantity } from './cart.service';

describe('Panier de la boutique', () => {
  beforeEach(() => localStorage.removeItem('librairie.boutique.panier'));

  it('borne les quantités à la disponibilité', () => {
    expect(clampQuantity(5, 3)).toBe(3);
    expect(clampQuantity(150, null)).toBe(99);
    expect(clampQuantity(-2, 10)).toBe(0);
  });

  it('additionne, conserve et vide le panier', () => {
    const cart = TestBed.inject(CartService);
    const article = { id: 'a', code: 'A', name: 'Kit 6e', price: 15000, image: null, type: 'KIT', available: 2 };
    cart.add(article);
    cart.add(article);
    expect(cart.add(article)).toBe(2);
    expect(cart.total()).toBe(30000);
    expect(JSON.parse(localStorage.getItem('librairie.boutique.panier')!)[0].quantity).toBe(2);
    cart.setQuantity('a', 0);
    expect(cart.count()).toBe(0);
  });

  it('calcule l’acompte et l’étape de suivi', () => {
    expect(depositAmount(2001, 30)).toBe(601);
    expect(depositAmount(2000, 0)).toBe(0);
    expect(stepIndex('READY')).toBe(3);
    expect(stepIndex('CANCELLED')).toBe(-1);
  });
});
