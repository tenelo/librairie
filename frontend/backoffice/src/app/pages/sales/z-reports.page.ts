import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { APP_CONFIG, FcfaPipe, NetworkStatusService, Paginated, PrinterService } from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

import { PosService } from './pos.service';
import { LibraryScopeService } from '../../services/library-scope.service';
import { presetRange } from '../stats/report-format';

interface ServerSession {
  id: string;
  device_code: string | null;
  depot_code: string;
  status: string;
  status_label: string;
  opened_by_name: string;
  opened_at: string;
  closed_at: string | null;
  closed_by_name: string | null;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
  z_number: string;
}

interface FilterOptions {
  devices: { id: string; code: string }[];
  cashiers: { id: string; name: string }[];
}

interface ZReport {
  z_number: string;
  device: string | null;
  sales_count: number;
  sales_total: number;
  discount_total: number;
  returns_count: number;
  returns_total: number;
  payments: Record<string, { label: string; total: number }>;
  first_receipt: string | null;
  last_receipt: string | null;
  cash_in: number;
  cash_out: number;
  opening_float: number;
  expected_cash: number;
  counted_cash: number | null;
  variance: number | null;
  closed_by: string | null;
  closed_at: string | null;
}

/** Rapports caisse (une ligne par session de caisse), filtrés par période et librairie, paginés, réimprimables. */
@Component({
  selector: 'bo-z-reports-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatIconModule, MatPaginatorModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Rapports caisses</h1>
    @if (!network.online()) {
      <p class="offline-note">Hors connexion : le rapport caisse de la caisse en cours s'imprime depuis « Ouverture / Clôture ».</p>
    }
    <div class="toolbar filters">
      <label>Du <input type="date" [(ngModel)]="dateFrom" (change)="reloadAll()" /></label>
      <label>au <input type="date" [(ngModel)]="dateTo" (change)="reloadAll()" /></label>
      @if (scope.seesAll()) {
        <label>Librairie
          <select [(ngModel)]="library" (change)="reloadAll()">
            @for (o of scope.reportOptions(); track o.value) { <option [ngValue]="o.value">{{ o.label }}</option> }
          </select>
        </label>
      } @else {
        <span>Librairie : <strong>{{ scope.label() }}</strong></span>
      }
      <label>Caisse
        <select [(ngModel)]="device" (change)="load(0)">
          <option value="">Toutes</option>
          @for (d of options().devices; track d.id) { <option [value]="d.id">{{ d.code }}</option> }
        </select>
      </label>
      <label>Caissier
        <select [(ngModel)]="cashier" (change)="load(0)">
          <option value="">Tous</option>
          @for (c of options().cashiers; track c.id) { <option [value]="c.id">{{ c.name }}</option> }
        </select>
      </label>
    </div>
    <table class="list">
      <thead><tr><th>Rapport</th><th>Terminal</th><th>Période</th><th class="num">Attendu</th><th class="num">Compté</th><th class="num">Écart</th><th></th></tr></thead>
      <tbody>
        @for (s of sessions(); track s.id) {
          <tr>
            <td><strong>{{ s.z_number || '—' }}</strong><br /><small class="muted">{{ s.status_label }}</small></td>
            <td>{{ s.device_code }} · {{ s.depot_code }}</td>
            <td>{{ s.opened_at | date: 'dd/MM/yyyy HH:mm' }} → {{ s.closed_at ? (s.closed_at | date: 'dd/MM HH:mm') : 'en cours' }}<br />
              <small class="muted">{{ s.opened_by_name }}</small></td>
            <td class="num">{{ s.expected_cash ?? 0 | fcfa }}</td>
            <td class="num">{{ s.counted_cash ?? 0 | fcfa }}</td>
            <td class="num" [class.error]="!!s.variance">{{ s.variance ?? 0 | fcfa }}</td>
            <td class="num"><button mat-stroked-button type="button" (click)="print(s)" aria-label="Imprimer le rapport caisse"><mat-icon>print</mat-icon></button></td>
          </tr>
        } @empty {
          <tr><td colspan="7" class="empty">Aucune session sur la période.</td></tr>
        }
      </tbody>
    </table>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="pageSize()" [pageSizeOptions]="[10, 25, 50, 100]"
                   [showFirstLastButtons]="true" (page)="onPage($event)" aria-label="Pages des rapports caisses" />
  `,
  styleUrl: './sales-page.scss',
  styles: `
    .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
    .filters input, .filters select { font: inherit; padding: 4px; }
  `,
})
export class ZReportsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly printer = inject(PrinterService);
  private readonly pos = inject(PosService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly scope = inject(LibraryScopeService);
  protected readonly sessions = signal<ServerSession[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly pageSize = signal(25);
  /** Période par défaut : les 30 derniers jours. */
  protected dateFrom = presetRange('30d').date_from;
  protected dateTo = presetRange('30d').date_to;
  protected library = '';
  protected device = '';
  protected cashier = '';
  /** Caisses et caissiers présents sur la période et la librairie choisies. */
  protected readonly options = signal<FilterOptions>({ devices: [], cashiers: [] });

  constructor() {
    this.scope.load();
    this.reloadAll();
  }

  /** Période ou librairie changée : listes Caisse / Caissier mises à jour, puis première page. */
  protected reloadAll(): void {
    this.http.get<FilterOptions>(`${this.api}/sales/sessions/filter-options/`, { params: this.baseParams() }).subscribe({
      next: (options) => {
        this.options.set(options);
        // Un choix qui n'existe plus sur la nouvelle période est retiré.
        if (this.device && !options.devices.some((d) => d.id === this.device)) {
          this.device = '';
        }
        if (this.cashier && !options.cashiers.some((c) => c.id === this.cashier)) {
          this.cashier = '';
        }
        this.load(0);
      },
      error: () => this.load(0),
    });
  }

  private baseParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.dateFrom) {
      params['date_from'] = this.dateFrom;
    }
    if (this.dateTo) {
      params['date_to'] = this.dateTo;
    }
    if (this.library) {
      params['library'] = this.library;
    }
    return params;
  }

  protected load(page = this.page()): void {
    this.page.set(page);
    const params: Record<string, string | number> = { ...this.baseParams(), page: page + 1, page_size: this.pageSize() };
    if (this.device) {
      params['device'] = this.device;
    }
    if (this.cashier) {
      params['cashier'] = this.cashier;
    }
    this.http.get<Paginated<ServerSession>>(`${this.api}/sales/sessions/`, { params }).subscribe({
      next: (result) => {
        this.sessions.set(result.results);
        this.total.set(result.count);
      },
      error: () => undefined,
    });
  }

  protected onPage(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.load(event.pageIndex);
  }

  protected async print(session: ServerSession): Promise<void> {
    const z = await firstValueFrom(this.http.get<ZReport>(`${this.api}/sales/sessions/${session.id}/z-report/`));
    const fmt = (v: number | null) => `${new Intl.NumberFormat('fr-CI').format(v ?? 0)} FCFA`;
    await this.printer.print({
      title: 'RAPPORT CAISSE', number: z.z_number || session.id.slice(0, 8), date: z.closed_at ?? new Date().toISOString(),
      cashier: z.closed_by ?? session.opened_by_name, device: z.device ?? '', customer: null, lines: [],
      subtotal: z.sales_total, discountTotal: 0, total: z.sales_total, payments: [], change: 0, loyaltyPoints: null,
      duplicate: false, qrValue: null, library: await this.pos.library(),
      extra: [
        { label: 'Fond de caisse', value: fmt(z.opening_float) },
        { label: 'Ventes', value: `${z.sales_count} (${fmt(z.sales_total)})` },
        { label: 'Remises', value: fmt(z.discount_total) },
        ...Object.values(z.payments).map((p) => ({ label: p.label, value: fmt(p.total) })),
        { label: 'Retours', value: `${z.returns_count} (${fmt(z.returns_total)})` },
        { label: "Entrées d'espèces", value: fmt(z.cash_in) },
        { label: "Sorties d'espèces", value: fmt(z.cash_out) },
        { label: 'Espèces attendues', value: fmt(z.expected_cash) },
        { label: 'Espèces comptées', value: fmt(z.counted_cash) },
        { label: 'Écart', value: fmt(z.variance) },
        { label: 'Reçus', value: z.first_receipt ? `${z.first_receipt} → ${z.last_receipt}` : '—' },
      ],
    });
  }
}
