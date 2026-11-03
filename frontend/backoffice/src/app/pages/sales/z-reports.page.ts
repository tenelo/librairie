import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { APP_CONFIG, FcfaPipe, NetworkStatusService, Paginated, PrinterService } from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

import { PosService } from './pos.service';

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

/** Rapports Z des sessions clôturées (données consolidées du serveur), réimprimables. */
@Component({
  selector: 'bo-z-reports-page',
  imports: [DatePipe, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Rapports Z</h1>
    @if (!network.online()) {
      <p class="offline-note">Hors connexion : le rapport Z de la caisse en cours s'imprime depuis « Ouverture / Clôture ».</p>
    }
    <table class="list">
      <thead><tr><th>Rapport</th><th>Terminal</th><th>Période</th><th class="num">Attendu</th><th class="num">Compté</th><th class="num">Écart</th><th></th></tr></thead>
      <tbody>
        @for (s of sessions(); track s.id) {
          <tr>
            <td><strong>{{ s.z_number || '—' }}</strong><br /><small class="muted">{{ s.status_label }}</small></td>
            <td>{{ s.device_code }} · {{ s.depot_code }}</td>
            <td>{{ s.opened_at | date: 'dd/MM HH:mm' }} → {{ s.closed_at ? (s.closed_at | date: 'dd/MM HH:mm') : 'en cours' }}<br />
              <small class="muted">{{ s.opened_by_name }}</small></td>
            <td class="num">{{ s.expected_cash ?? 0 | fcfa }}</td>
            <td class="num">{{ s.counted_cash ?? 0 | fcfa }}</td>
            <td class="num" [class.error]="!!s.variance">{{ s.variance ?? 0 | fcfa }}</td>
            <td class="num"><button mat-stroked-button type="button" (click)="print(s)"><mat-icon>print</mat-icon></button></td>
          </tr>
        } @empty {
          <tr><td colspan="7" class="empty">Aucune session.</td></tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: './sales-page.scss',
})
export class ZReportsPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly printer = inject(PrinterService);
  private readonly pos = inject(PosService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly sessions = signal<ServerSession[]>([]);

  constructor() {
    this.http.get<Paginated<ServerSession>>(`${this.api}/sales/sessions/`, { params: { page_size: 100 } })
      .subscribe({ next: (page) => this.sessions.set(page.results), error: () => undefined });
  }

  protected async print(session: ServerSession): Promise<void> {
    const z = await firstValueFrom(this.http.get<ZReport>(`${this.api}/sales/sessions/${session.id}/z-report/`));
    const fmt = (v: number | null) => `${new Intl.NumberFormat('fr-CI').format(v ?? 0)} FCFA`;
    await this.printer.print({
      title: 'RAPPORT Z', number: z.z_number || session.id.slice(0, 8), date: z.closed_at ?? new Date().toISOString(),
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
