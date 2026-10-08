import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG, OnlineOrder, Paginated, ShopArticle, ShopKit, ShopReference } from '@librairie/shared';
import { Observable, shareReplay } from 'rxjs';

export interface PlaceOrderRequest {
  pickup_depot: string | null;
  pickup_slot: string | null;
  comment: string;
  accept_partial: boolean;
  payment_mode: 'ON_PICKUP' | 'DEPOSIT';
  lines: { article: string; quantity: number }[];
}

export interface DepositStart {
  reference: string;
  amount: number;
  status: string;
  instructions: string;
  redirect_url: string;
  sandbox: boolean;
}

function params(query: Record<string, string | number | null | undefined>): HttpParams {
  let result = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      result = result.set(key, String(value));
    }
  }
  return result;
}

/** API publique (catalogue) et client (commandes) de la boutique. */
@Injectable({ providedIn: 'root' })
export class ShopApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/shop`;
  private reference$?: Observable<ShopReference>;

  reference(): Observable<ShopReference> {
    this.reference$ ??= this.http.get<ShopReference>(`${this.api}/reference/`).pipe(shareReplay(1));
    return this.reference$;
  }

  articles(query: { search?: string; category?: string | null; page?: number; type?: string }):
    Observable<Paginated<ShopArticle>> {
    return this.http.get<Paginated<ShopArticle>>(`${this.api}/articles/`, { params: params({ page_size: 24, ...query }) });
  }

  article(id: string): Observable<ShopArticle> {
    return this.http.get<ShopArticle>(`${this.api}/articles/${id}/`);
  }

  kits(school: string | null, level: string | null): Observable<Paginated<ShopKit>> {
    return this.http.get<Paginated<ShopKit>>(`${this.api}/kits/`, { params: params({ school, level, page_size: 100 }) });
  }

  orders(): Observable<Paginated<OnlineOrder>> {
    return this.http.get<Paginated<OnlineOrder>>(`${this.api}/orders/`, { params: params({ page_size: 50 }) });
  }

  order(id: string): Observable<OnlineOrder> {
    return this.http.get<OnlineOrder>(`${this.api}/orders/${id}/`);
  }

  place(order: PlaceOrderRequest): Observable<OnlineOrder> {
    return this.http.post<OnlineOrder>(`${this.api}/orders/`, order);
  }

  cancel(id: string): Observable<OnlineOrder> {
    return this.http.post<OnlineOrder>(`${this.api}/orders/${id}/cancel/`, {});
  }

  answer(id: string, accept: boolean): Observable<OnlineOrder> {
    return this.http.post<OnlineOrder>(`${this.api}/orders/${id}/answer/`, { accept });
  }

  deposit(id: string, phone: string, operator: string): Observable<DepositStart> {
    return this.http.post<DepositStart>(`${this.api}/orders/${id}/deposit/`, { phone, operator });
  }

  simulatePayment(reference: string, success: boolean): Observable<{ status: string; message: string }> {
    return this.http.post<{ status: string; message: string }>(`${this.api}/payments/${reference}/simulate/`,
      { success });
  }
}
