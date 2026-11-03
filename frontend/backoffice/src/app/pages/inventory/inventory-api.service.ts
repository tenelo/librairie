import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG, CatalogQuery, Paginated, toHttpParams } from '@librairie/shared';
import { Observable } from 'rxjs';

export type InventoryKind = 'FULL' | 'PARTIAL' | 'CYCLE';
export type InventoryStatus = 'DRAFT' | 'COUNTING' | 'REVIEW' | 'VALIDATED' | 'CLOSED' | 'CANCELLED';

export interface InventorySummary {
  articles: number;
  counted: number;
  to_recount: number;
  variance_value: number;
  variance_units: number;
}

export interface InventorySession {
  id: string;
  number: string;
  name: string;
  kind: InventoryKind;
  kind_label: string;
  status: InventoryStatus;
  status_label: string;
  depot: string;
  depot_name: string;
  categories: string[];
  locations: string[];
  articles: string[];
  counting_mode: 'SUM' | 'DOUBLE';
  double_count_threshold: number;
  assignments: { user: string; user_name?: string; categories: string[]; zone: string }[];
  frozen_at: string | null;
  validated_at: string | null;
  closed_at: string | null;
  created_by_name: string;
  validated_by_name: string | null;
  notes: string;
  summary: InventorySummary | Record<string, never>;
  created_at: string;
}

export interface VarianceLine {
  article: string;
  code: string;
  name: string;
  theoretical: number;
  movements_during: number;
  expected: number;
  first_count: number | null;
  second_count: number | null;
  counted: number | null;
  variance: number | null;
  unit_cost: number;
  variance_value: number;
  needs_recount: boolean;
}

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/inventory/sessions/`;

  list(query: CatalogQuery = {}): Observable<Paginated<InventorySession>> {
    return this.http.get<Paginated<InventorySession>>(this.api, { params: toHttpParams(query) });
  }
  get(id: string): Observable<InventorySession> {
    return this.http.get<InventorySession>(`${this.api}${id}/`);
  }
  create(session: Partial<InventorySession>): Observable<InventorySession> {
    return this.http.post<InventorySession>(this.api, session);
  }
  action(id: string, name: 'start' | 'review' | 'close' | 'cancel'): Observable<InventorySession> {
    return this.http.post<InventorySession>(`${this.api}${id}/${name}/`, {});
  }
  validate(id: string, uncountedAsZero: boolean): Observable<InventorySession> {
    return this.http.post<InventorySession>(`${this.api}${id}/validate/`, { uncounted_as_zero: uncountedAsZero });
  }
  report(id: string): Observable<{ lines: VarianceLine[]; summary: InventorySummary }> {
    return this.http.get<{ lines: VarianceLine[]; summary: InventorySummary }>(`${this.api}${id}/report/`);
  }
  file(id: string, kind: 'export' | 'pdf'): Observable<Blob> {
    return this.http.get(`${this.api}${id}/${kind}/`, { responseType: 'blob' });
  }
}
