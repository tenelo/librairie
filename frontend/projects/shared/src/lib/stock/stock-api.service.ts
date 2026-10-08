import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CatalogQuery, toHttpParams } from '../catalog/catalog-api.service';
import { APP_CONFIG } from '../config/app-config';
import { Paginated } from '../models/auth.models';
import {
  GoodsReceipt,
  GoodsReceiptInput,
  PurchaseOrder,
  PurchaseOrderInput,
  ReorderSuggestion,
  Supplier,
} from '../models/purchasing.models';
import {
  AssemblyOperation,
  Depot,
  KitAssembly,
  StockAdjustmentInput,
  StockAlert,
  StockCardLine,
  StockMovement,
  StockStateRow,
  StockSummary,
  StockTransfer,
  StockTransferInput,
} from '../models/stock.models';

/** Accès aux API de stock (dépôts, état, mouvements, transferts, assemblages, alertes). */
@Injectable({ providedIn: 'root' })
export class StockApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/stock`;

  listDepots(): Observable<Depot[]> {
    return this.http.get<Depot[]>(`${this.api}/depots/`);
  }
  saveDepot(depot: Partial<Depot>): Observable<Depot> {
    return depot.id
      ? this.http.patch<Depot>(`${this.api}/depots/${depot.id}/`, depot)
      : this.http.post<Depot>(`${this.api}/depots/`, depot);
  }
  state(query: CatalogQuery): Observable<Paginated<StockStateRow>> {
    return this.http.get<Paginated<StockStateRow>>(`${this.api}/state/`, { params: toHttpParams(query) });
  }
  summary(depot?: string): Observable<StockSummary> {
    return this.http.get<StockSummary>(`${this.api}/summary/`, { params: toHttpParams({ depot }) });
  }
  movements(query: CatalogQuery): Observable<Paginated<StockMovement>> {
    return this.http.get<Paginated<StockMovement>>(`${this.api}/movements/`, { params: toHttpParams(query) });
  }
  card(article: string, depot?: string): Observable<StockCardLine[]> {
    return this.http.get<StockCardLine[]>(`${this.api}/movements/card/`, { params: toHttpParams({ article, depot }) });
  }
  adjust(input: StockAdjustmentInput): Observable<StockMovement> {
    return this.http.post<StockMovement>(`${this.api}/movements/adjust/`, input);
  }
  listTransfers(query: CatalogQuery): Observable<Paginated<StockTransfer>> {
    return this.http.get<Paginated<StockTransfer>>(`${this.api}/transfers/`, { params: toHttpParams(query) });
  }
  getTransfer(id: string): Observable<StockTransfer> {
    return this.http.get<StockTransfer>(`${this.api}/transfers/${id}/`);
  }
  saveTransfer(input: StockTransferInput, id?: string): Observable<StockTransfer> {
    return id
      ? this.http.put<StockTransfer>(`${this.api}/transfers/${id}/`, input)
      : this.http.post<StockTransfer>(`${this.api}/transfers/`, input);
  }
  validateTransfer(id: string): Observable<StockTransfer> {
    return this.http.post<StockTransfer>(`${this.api}/transfers/${id}/validate/`, {});
  }
  cancelTransfer(id: string): Observable<StockTransfer> {
    return this.http.post<StockTransfer>(`${this.api}/transfers/${id}/cancel/`, {});
  }
  listAssemblies(query: CatalogQuery = {}): Observable<Paginated<KitAssembly>> {
    return this.http.get<Paginated<KitAssembly>>(`${this.api}/assemblies/`, { params: toHttpParams(query) });
  }
  assemble(kit: string, depot: string, operation: AssemblyOperation, quantity: number, note: string) {
    return this.http.post<KitAssembly>(`${this.api}/assemblies/`, { kit, depot, operation, quantity, note });
  }
  refreshAlerts(): Observable<{ open: number }> {
    return this.http.post<{ open: number }>(`${this.api}/alerts/refresh/`, {});
  }
  alerts(resolved = false): Observable<Paginated<StockAlert>> {
    return this.http.get<Paginated<StockAlert>>(`${this.api}/alerts/`, {
      params: toHttpParams({ resolved: resolved || null, page_size: 500 }),
    });
  }
}

/** Accès aux API d'achats (fournisseurs, bons de commande, réceptions, suggestions). */
@Injectable({ providedIn: 'root' })
export class PurchasingApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/purchasing`;

  listSuppliers(query: CatalogQuery = {}): Observable<Paginated<Supplier>> {
    return this.http.get<Paginated<Supplier>>(`${this.api}/suppliers/`, {
      params: toHttpParams({ page_size: 500, ...query }),
    });
  }
  saveSupplier(supplier: Partial<Supplier>): Observable<Supplier> {
    return supplier.id
      ? this.http.patch<Supplier>(`${this.api}/suppliers/${supplier.id}/`, supplier)
      : this.http.post<Supplier>(`${this.api}/suppliers/`, supplier);
  }
  listOrders(query: CatalogQuery): Observable<Paginated<PurchaseOrder>> {
    return this.http.get<Paginated<PurchaseOrder>>(`${this.api}/orders/`, { params: toHttpParams(query) });
  }
  getOrder(id: string): Observable<PurchaseOrder> {
    return this.http.get<PurchaseOrder>(`${this.api}/orders/${id}/`);
  }
  saveOrder(input: PurchaseOrderInput, id?: string): Observable<PurchaseOrder> {
    return id
      ? this.http.put<PurchaseOrder>(`${this.api}/orders/${id}/`, input)
      : this.http.post<PurchaseOrder>(`${this.api}/orders/`, input);
  }
  orderAction(id: string, action: 'send' | 'cancel' | 'close'): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.api}/orders/${id}/${action}/`, {});
  }
  orderPdf(id: string): Observable<Blob> {
    return this.http.get(`${this.api}/orders/${id}/pdf/`, { responseType: 'blob' });
  }
  orderDocument(id: string): Observable<string> {
    return this.http.get(`${this.api}/orders/${id}/document/`, { responseType: 'text' });
  }
  listReceipts(query: CatalogQuery): Observable<Paginated<GoodsReceipt>> {
    return this.http.get<Paginated<GoodsReceipt>>(`${this.api}/receipts/`, { params: toHttpParams(query) });
  }
  getReceipt(id: string): Observable<GoodsReceipt> {
    return this.http.get<GoodsReceipt>(`${this.api}/receipts/${id}/`);
  }
  createReceipt(input: GoodsReceiptInput): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(`${this.api}/receipts/`, input);
  }
  suggestions(query: CatalogQuery = {}): Observable<ReorderSuggestion[]> {
    return this.http.get<ReorderSuggestion[]>(`${this.api}/suggestions/`, { params: toHttpParams(query) });
  }
  createOrdersFromSuggestions(depot: string, items: { article: string; supplier: string; quantity: number;
    unit_cost: number }[]): Observable<PurchaseOrder[]> {
    return this.http.post<PurchaseOrder[]>(`${this.api}/suggestions/create-orders/`, { depot, items });
  }
}

/** Dépôt proposé par défaut : celui du terminal, sinon le dépôt par défaut, sinon le premier actif. */
export function defaultDepotId(depots: Depot[], deviceDepot?: string | null): string | null {
  const active = depots.filter((d) => d.is_active);
  return (
    active.find((d) => d.id === deviceDepot)?.id ?? active.find((d) => d.is_default)?.id ?? active[0]?.id ?? null
  );
}
