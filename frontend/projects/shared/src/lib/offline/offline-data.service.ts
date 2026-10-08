import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, of, switchMap, timeout } from 'rxjs';

import { CatalogApiService } from '../catalog/catalog-api.service';
import { ArticleLookup } from '../models/catalog.models';
import { NetworkStatusService } from '../network/network-status.service';
import { StockDelta, SyncedRow } from './local-db';
import { LocalDbService } from './local-db.service';

const ONLINE_TIMEOUT_MS = 6000;

export function rowToLookup(row: SyncedRow, barcode: string | null = null): ArticleLookup {
  return {
    id: row.id,
    code: String(row['code'] ?? ''),
    name: String(row['name'] ?? ''),
    type: row['type'] as ArticleLookup['type'],
    retail_price: Number(row['retail_price'] ?? 0),
    avg_cost: Number(row['avg_cost'] ?? 0),
    is_active: Boolean(row['is_active']),
    barcode,
  };
}

/**
 * Lecture des données métier en ligne, avec repli automatique sur la base locale
 * (hors connexion ou serveur injoignable). Les écrans utilisables hors ligne passent par ici.
 */
@Injectable({ providedIn: 'root' })
export class OfflineDataService {
  private readonly local = inject(LocalDbService);
  private readonly catalog = inject(CatalogApiService);
  private readonly network = inject(NetworkStatusService);

  /** Recherche d'articles (nom, code, code-barres) : API si en ligne, sinon base locale. */
  searchArticles(term: string, excludeKits = false): Observable<ArticleLookup[]> {
    const local$ = from(this.searchLocal(term, excludeKits));
    if (!this.network.online()) {
      return local$;
    }
    return this.catalog.lookupArticles(term, excludeKits).pipe(
      timeout(ONLINE_TIMEOUT_MS),
      catchError(() => local$),
    );
  }

  articleByBarcode(code: string): Observable<ArticleLookup | null> {
    const local$ = from(this.findLocalByCode(code));
    if (!this.network.online()) {
      return local$;
    }
    return this.catalog.articleByBarcode(code).pipe(
      timeout(ONLINE_TIMEOUT_MS),
      switchMap((article) => of<ArticleLookup | null>({ id: article.id, code: article.code, name: article.name,
        type: article.type, retail_price: article.retail_price, avg_cost: article.avg_cost,
        is_active: article.is_active, barcode: article.barcodes[0]?.code ?? null })),
      catchError(() => local$),
    );
  }

  async searchLocal(term: string, excludeKits = false, limit = 20): Promise<ArticleLookup[]> {
    const needle = term.trim().toLowerCase();
    if (!needle) {
      return [];
    }
    const byBarcode = await this.local.db.barcodes.where('code').equals(term.trim()).first();
    if (byBarcode) {
      const article = await this.local.db.articles.get(String(byBarcode['article']));
      return article ? [rowToLookup(article, String(byBarcode['code']))] : [];
    }
    const rows = await this.local.db.articles
      .filter((row) => Boolean(row['is_active']) && (!excludeKits || row['type'] !== 'KIT') &&
        (String(row['name']).toLowerCase().includes(needle) || String(row['code']).toLowerCase().includes(needle)))
      .limit(limit)
      .toArray();
    return rows.sort((a, b) => String(a['name']).localeCompare(String(b['name']), 'fr')).map((row) => rowToLookup(row));
  }

  async findLocalByCode(code: string): Promise<ArticleLookup | null> {
    const barcode = await this.local.db.barcodes.where('code').equals(code).first();
    const article = barcode
      ? await this.local.db.articles.get(String(barcode['article']))
      : await this.local.db.articles.where('code').equalsIgnoreCase(code).first();
    return article ? rowToLookup(article, barcode ? String(barcode['code']) : null) : null;
  }

  /**
   * Variation de stock induite localement par une quantité d'article (même règle que le serveur) :
   * un lot est converti en unités de son article de base ; services et kits virtuels n'en ont pas.
   */
  async stockDeltas(articleId: string, depot: string, quantity: number): Promise<StockDelta[]> {
    const article = await this.local.db.articles.get(articleId);
    if (!article || article['type'] === 'SERVICE') {
      return [];
    }
    if (article['type'] === 'LOT') {
      return [{ article: String(article['lot_base_article']), depot, quantity: quantity * Number(article['lot_units'] ?? 1) }];
    }
    if (article['type'] === 'KIT') {
      const kit = await this.local.db.kits.where('article').equals(articleId).first();
      if (!kit || kit['stock_mode'] === 'VIRTUAL') {
        return [];
      }
    }
    return [{ article: articleId, depot, quantity }];
  }

  async table(name: 'depots' | 'suppliers' | 'purchase_orders'): Promise<SyncedRow[]> {
    return this.local.db[name].toArray();
  }
}
