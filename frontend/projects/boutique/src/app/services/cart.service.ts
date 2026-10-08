import { Injectable, computed, signal } from '@angular/core';
import { ShopArticle } from '@librairie/shared';

export interface ShopCartLine {
  article: Pick<ShopArticle, 'id' | 'code' | 'name' | 'price' | 'image' | 'type' | 'available'>;
  quantity: number;
}

const STORAGE_KEY = 'librairie.boutique.panier';
export const MAX_QTY = 99;

/** Quantité ajoutée bornée par la disponibilité affichée (null = illimitée) et le maximum par ligne. */
export function clampQuantity(quantity: number, available: number | null): number {
  const limit = available === null ? MAX_QTY : Math.min(available, MAX_QTY);
  return Math.max(0, Math.min(Math.trunc(quantity) || 0, limit));
}

export function cartTotal(lines: ShopCartLine[]): number {
  return lines.reduce((sum, line) => sum + line.article.price * line.quantity, 0);
}

/** Panier de la boutique, conservé dans le navigateur (survit à la fermeture de l'onglet). */
@Injectable({ providedIn: 'root' })
export class CartService {
  readonly lines = signal<ShopCartLine[]>(this.restore());
  readonly count = computed(() => this.lines().reduce((sum, line) => sum + line.quantity, 0));
  readonly total = computed(() => cartTotal(this.lines()));

  add(article: ShopCartLine['article'], quantity = 1): number {
    const existing = this.lines().find((line) => line.article.id === article.id);
    const wanted = clampQuantity((existing?.quantity ?? 0) + quantity, article.available);
    if (wanted <= 0) {
      return 0;
    }
    this.save(existing
      ? this.lines().map((line) => (line.article.id === article.id ? { article, quantity: wanted } : line))
      : [...this.lines(), { article, quantity: wanted }]);
    return wanted;
  }

  setQuantity(articleId: string, quantity: number): void {
    this.save(this.lines()
      .map((line) => (line.article.id === articleId
        ? { ...line, quantity: clampQuantity(quantity, line.article.available) } : line))
      .filter((line) => line.quantity > 0));
  }

  remove(articleId: string): void {
    this.save(this.lines().filter((line) => line.article.id !== articleId));
  }

  clear(): void {
    this.save([]);
  }

  private save(lines: ShopCartLine[]): void {
    this.lines.set(lines);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Stockage indisponible (navigation privée) : le panier reste en mémoire.
    }
  }

  private restore(): ShopCartLine[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ShopCartLine[]) : [];
    } catch {
      return [];
    }
  }
}
