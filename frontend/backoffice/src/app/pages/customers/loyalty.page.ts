import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LocalDbService, SyncedRow } from '@librairie/shared';

/** Programme de fidélité : points cumulés par client, convertibles en remise à la caisse. */
@Component({
  selector: 'bo-loyalty-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Fidélité</h1>
    <p class="muted">{{ perThousand() }} point(s) par tranche de 1 000 FCFA d'achat ; 1 point = {{ pointValue() }} FCFA de remise,
      utilisable à la caisse (réglages dans Administration › Paramètres).</p>
    <table class="list">
      <thead><tr><th>Client</th><th class="num">Points</th><th class="num">Valeur</th></tr></thead>
      <tbody>
        @for (c of customers(); track c.id) {
          <tr><td>{{ c['name'] }} <small class="muted">{{ c['phone'] }}</small></td>
            <td class="num">{{ c['loyalty_points'] }}</td>
            <td class="num">{{ $any(c['loyalty_points']) * pointValue() }} FCFA</td></tr>
        } @empty { <tr><td colspan="3" class="empty">Aucun client n'a encore de points.</td></tr> }
      </tbody>
    </table>
  `,
  styleUrl: '../sales/sales-page.scss',
})
export class LoyaltyPage {
  private readonly local = inject(LocalDbService);
  protected readonly customers = signal<SyncedRow[]>([]);
  protected readonly pointValue = signal(10);
  protected readonly perThousand = signal(1);

  constructor() {
    void (async () => {
      const settings = await this.local.db.settings.toCollection().first();
      this.pointValue.set(Number(settings?.['loyalty_point_value'] ?? 10));
      this.perThousand.set(Number(settings?.['loyalty_points_per_1000'] ?? 1));
      const rows = await this.local.db.customers.filter((c) => Number(c['loyalty_points'] ?? 0) > 0).toArray();
      this.customers.set(rows.sort((a, b) => Number(b['loyalty_points']) - Number(a['loyalty_points'])));
    })();
  }
}
