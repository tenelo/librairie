import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG, Paginated } from '@librairie/shared';
import { Observable } from 'rxjs';

export type TontineStatus = 'OPEN' | 'DELIVERED' | 'CANCELLED';

export interface TontineLine {
  id: string;
  article: string;
  article_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface TontinePayment {
  id: string;
  number: string;
  kind: 'PAYMENT' | 'REFUND';
  kind_label: string;
  amount: number;
  method_code: string;
  method_label: string;
  reference: string;
  cash_session: string | null;
  user_name: string;
  paid_at: string;
}

/** Tontine scolaire : les fournitures se paient en plusieurs versements, puis se retirent à la caisse. */
export interface Tontine {
  id: string;
  number: string;
  subscriber_name: string;
  subscriber_phone: string;
  depot: string;
  depot_name: string;
  library: string | null;
  library_name: string | null;
  target_amount: number;
  paid_amount: number;
  used_amount: number;
  /** Versé et pas encore imputé sur la vente de remise. */
  available: number;
  /** Reste à verser pour atteindre le montant prévu. */
  remaining: number;
  progress: number;
  status: TontineStatus;
  status_label: string;
  notes: string;
  created_by_name: string;
  created_at: string;
  school_year: string | null;
  /** Ex. « 2026-2027 ». */
  school_year_label: string | null;
  sale: string | null;
  sale_receipt: string | null;
  delivered_at: string | null;
  delivered_by_name: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string;
  lines: TontineLine[];
  payments: TontinePayment[];
}

/** Filtres de la liste, du récapitulatif et de l'historique. */
export interface TontineFilters {
  status?: string;
  search?: string;
  school_year?: string;
}

/** Une ligne de la traçabilité d'une souscription (journal d'audit). */
export interface TontineEvent {
  date: string;
  action: string;
  user: string;
  description: string;
}

function filterParams(filters: TontineFilters, params = new HttpParams()): HttpParams {
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params = params.set(key, value);
    }
  }
  return params;
}

/** Récapitulatif des souscriptions affichées (mêmes filtres que la liste). */
export interface TontineSummary {
  subscribers_count: number;
  subscriptions_count: number;
  expected_total: number;
  received_total: number;
  /** Kits les plus souscrits (10 au plus), en nombre de kits. */
  kits: { label: string; quantity: number }[];
}

/** Souscription : nom et prénoms, téléphone et articles souscrits (prix du jour, figés). */
export interface TontineRequest {
  subscriber_name: string;
  subscriber_phone: string;
  /** Année scolaire ; à défaut, l'année en cours. */
  school_year?: string | null;
  /** Dépôt de remise ; à défaut, celui du terminal ou de la librairie de l'employé. */
  depot?: string;
  lines: { article: string; quantity: number }[];
}

export interface TontinePayRequest {
  amount: number;
  method: string;
  reference?: string;
  cash_session: string | null;
}

export interface TontineCancelRequest {
  reason: string;
  method: string;
  reference?: string;
  cash_session: string | null;
}

@Injectable({ providedIn: 'root' })
export class TontinesApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/sales/tontines/`;

  /** Une page de souscriptions (`page` commence à 1). */
  list(filters: TontineFilters = {}, page = 1, pageSize = 10): Observable<Paginated<Tontine>> {
    const params = filterParams(filters, new HttpParams().set('page', page).set('page_size', pageSize));
    return this.http.get<Paginated<Tontine>>(this.api, { params });
  }

  summary(filters: TontineFilters = {}): Observable<TontineSummary> {
    return this.http.get<TontineSummary>(`${this.api}summary/`, { params: filterParams(filters) });
  }

  /** Fichier Excel des kits et articles souscrits (mêmes filtres que la liste), avec stock et besoins. */
  exportExcel(filters: TontineFilters = {}): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.api}export/`, { params: filterParams(filters), responseType: 'blob',
      observe: 'response' });
  }

  /** Traçabilité : création, versements, modifications, remise, annulation (date et auteur). */
  history(id: string): Observable<TontineEvent[]> {
    return this.http.get<TontineEvent[]>(`${this.api}${id}/history/`);
  }

  get(id: string): Observable<Tontine> {
    return this.http.get<Tontine>(`${this.api}${id}/`);
  }

  create(request: TontineRequest): Observable<Tontine> {
    return this.http.post<Tontine>(this.api, request);
  }

  /** Nom et téléphone du souscripteur restent modifiables. */
  update(id: string, changes: Partial<Pick<Tontine, 'subscriber_name' | 'subscriber_phone'>>): Observable<Tontine> {
    return this.http.patch<Tontine>(`${this.api}${id}/`, changes);
  }

  pay(id: string, request: TontinePayRequest): Observable<TontinePayment> {
    return this.http.post<TontinePayment>(`${this.api}${id}/pay/`, request);
  }

  cancel(id: string, request: TontineCancelRequest): Observable<Tontine> {
    return this.http.post<Tontine>(`${this.api}${id}/cancel/`, request);
  }
}
