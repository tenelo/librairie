import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_CONFIG, Paginated } from '@librairie/shared';
import { Observable } from 'rxjs';

export type ValueKind = 'money' | 'int' | 'percent' | 'decimal' | 'text' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ValueKind;
}

export interface ReportTable {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  chart?: { type: 'bar' | 'line'; x: string; y: string; limit?: number };
}

export interface SummaryItem {
  label: string;
  value: number;
  kind: ValueKind;
  previous?: number;
  variation?: number | null;
}

export interface ReportData {
  key: string;
  title: string;
  period: { date_from: string; date_to: string; depot: string | null; depot_name: string; days: number };
  summary: SummaryItem[];
  tables: ReportTable[];
}

export interface DashboardData {
  scope: 'today' | 'week' | 'month';
  period: ReportData['period'];
  kpis: (SummaryItem & { key: string })[];
  orders: { status: string; label: string; count: number }[];
  alerts: { low: number; out: number };
  chart: ReportTable;
  top: ReportTable | null;
}

export interface ScheduledReport {
  id?: number;
  name: string;
  report: string;
  report_label?: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  frequency_label?: string;
  recipients: string[];
  filters: Record<string, string>;
  send_hour: number;
  is_active: boolean;
  last_sent_at?: string | null;
  last_error?: string;
}

export interface ReportFilters {
  date_from?: string;
  date_to?: string;
  depot?: string | null;
  groups?: string;
}

function toParams(filters: ReportFilters & { export?: string }): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params = params.set(key, value);
    }
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ReportsApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/reports`;

  dashboard(scope: string, depot?: string | null): Observable<DashboardData> {
    return this.http.get<DashboardData>(`${this.api}/dashboard/`, { params: toParams({ depot }).set('scope', scope) });
  }
  report(name: string, filters: ReportFilters): Observable<ReportData> {
    return this.http.get<ReportData>(`${this.api}/${name}/`, { params: toParams(filters) });
  }
  file(name: string, filters: ReportFilters, format: 'xlsx' | 'pdf'): Observable<Blob> {
    return this.http.get(`${this.api}/${name}/`, { params: toParams({ ...filters, export: format }), responseType: 'blob' });
  }
  scheduled(): Observable<Paginated<ScheduledReport>> {
    return this.http.get<Paginated<ScheduledReport>>(`${this.api}/scheduled/`);
  }
  saveScheduled(report: ScheduledReport): Observable<ScheduledReport> {
    return report.id
      ? this.http.patch<ScheduledReport>(`${this.api}/scheduled/${report.id}/`, report)
      : this.http.post<ScheduledReport>(`${this.api}/scheduled/`, report);
  }
  deleteScheduled(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/scheduled/${id}/`);
  }
  sendScheduled(id: number): Observable<unknown> {
    return this.http.post(`${this.api}/scheduled/${id}/send/`, {});
  }
}
