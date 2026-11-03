import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG, OnlineOrder, Paginated } from '@librairie/shared';
import { Observable } from 'rxjs';

export type OrderGroup = 'to_confirm' | 'to_prepare' | 'ready' | 'picked_up' | 'closed';

export interface PickingLine {
  line: string;
  article: string;
  code: string;
  name: string;
  quantity: number;
  prepared_qty: number;
  location: string;
  barcodes: string[];
  components: { name: string; code: string; quantity: number }[];
}

export interface PrepareRequest {
  lines?: { line: string; prepared_qty: number }[];
  shortages?: { line: string; quantity: number; substitute?: string | null }[];
  ready?: boolean;
  parcels?: number;
}

@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/orders/orders/`;

  list(group: OrderGroup, search = ''): Observable<Paginated<OnlineOrder>> {
    let params = new HttpParams().set('group', group).set('page_size', 100);
    if (search) {
      params = params.set('search', search);
    }
    return this.http.get<Paginated<OnlineOrder>>(this.api, { params });
  }
  get(id: string): Observable<OnlineOrder> {
    return this.http.get<OnlineOrder>(`${this.api}${id}/`);
  }
  confirm(id: string): Observable<OnlineOrder> {
    return this.http.post<OnlineOrder>(`${this.api}${id}/confirm/`, {});
  }
  start(id: string, preparer?: string): Observable<OnlineOrder> {
    return this.http.post<OnlineOrder>(`${this.api}${id}/start/`, preparer ? { preparer } : {});
  }
  prepare(id: string, request: PrepareRequest): Observable<OnlineOrder> {
    return this.http.post<OnlineOrder>(`${this.api}${id}/prepare/`, request);
  }
  cancel(id: string, reason: string): Observable<OnlineOrder> {
    return this.http.post<OnlineOrder>(`${this.api}${id}/cancel/`, { reason });
  }
  picking(id: string): Observable<{ order: OnlineOrder; lines: PickingLine[] }> {
    return this.http.get<{ order: OnlineOrder; lines: PickingLine[] }>(`${this.api}${id}/picking/`);
  }
  lookup(code: string): Observable<OnlineOrder> {
    return this.http.get<OnlineOrder>(`${this.api}lookup/`, { params: { code } });
  }
}
