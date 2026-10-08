import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  Depot,
  DeviceService,
  FCFA_DENOMINATIONS,
  FcfaPipe,
  OfflineDataService,
  PrinterService,
  StockApiService,
  countDenominations,
  defaultDepotId,
} from '@librairie/shared';
import { catchError, from, map } from 'rxjs';

import { CashRegisterService, LocalZReport } from './cash-register.service';

/** Ouverture de caisse (fond), entrées/sorties d'espèces justifiées, clôture avec comptage et rapport Z. */
@Component({
  selector: 'bo-sessions-page',
  imports: [DatePipe, FormsModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Ouverture / Clôture de caisse</h1>
    @if (!device()) {
      <p class="offline-note">Ce poste n'est associé à aucun terminal : enregistrez-le dans Administration › Terminaux.</p>
    }
    @if (register.current(); as s) {
      <div class="card">
        <h2>Caisse ouverte depuis le {{ s.opened_at | date: 'dd/MM/yyyy HH:mm' }} par {{ s.opened_by }}</h2>
        @if (z(); as r) {
          <div class="kpis">
            <div><small>Fond de caisse</small><strong>{{ s.opening_float | fcfa }}</strong></div>
            <div><small>Ventes</small><strong>{{ r.salesCount }} · {{ r.salesTotal | fcfa }}</strong></div>
            <div><small>Espèces attendues</small><strong>{{ r.expectedCash | fcfa }}</strong></div>
            @for (m of r.byMethod; track m.label) { <div><small>{{ m.label }}</small><strong>{{ m.total | fcfa }}</strong></div> }
          </div>
        }
        <h3>Entrée / sortie d'espèces</h3>
        <div class="form-row">
          <select [(ngModel)]="movementKind" aria-label="Type"><option value="OUT">Sortie</option><option value="IN">Entrée</option></select>
          <input type="number" min="1" [(ngModel)]="movementAmount" placeholder="Montant" aria-label="Montant" />
          <input type="text" [(ngModel)]="movementReason" placeholder="Justification" aria-label="Justification" />
          <button mat-stroked-button type="button" (click)="addMovement()" [disabled]="!movementAmount || !movementReason.trim()">Enregistrer</button>
        </div>
        <h3>Clôture : comptage des billets et pièces</h3>
        <div class="denominations">
          @for (d of denominations; track d) {
            <label>{{ d | fcfa }} × <input type="number" min="0" [ngModel]="counts()[d] || 0" (ngModelChange)="setCount(d, $event)"
                                          [attr.aria-label]="'Nombre de ' + d" /></label>
          }
        </div>
        <p>Total compté : <strong>{{ counted() | fcfa }}</strong>
          @if (z(); as r) { · écart <strong [class.error]="counted() - r.expectedCash !== 0">{{ counted() - r.expectedCash | fcfa }}</strong> }</p>
        <input type="text" [(ngModel)]="notes" placeholder="Remarques de clôture" class="notes" aria-label="Remarques" />
        <div class="form-row">
          <button mat-stroked-button type="button" (click)="printX()"><mat-icon>print</mat-icon> Rapport X (intermédiaire)</button>
          <button mat-flat-button type="button" (click)="close()"><mat-icon>lock</mat-icon> Clôturer et imprimer le rapport Z</button>
        </div>
      </div>
    } @else {
      <div class="card">
        <h2>Ouvrir la caisse</h2>
        <div class="form-row">
          <select [(ngModel)]="depot" aria-label="Dépôt">
            @for (d of depots(); track d.id) { <option [value]="d.id">{{ d.name }}</option> }
          </select>
          <label>Fond de caisse (FCFA) <input type="number" min="0" [(ngModel)]="openingFloat" /></label>
          <button mat-flat-button type="button" (click)="open()" [disabled]="!device() || !depot"><mat-icon>lock_open</mat-icon> Ouvrir</button>
        </div>
      </div>
    }
  `,
  styleUrl: './sales-page.scss',
  styles: `
    .denominations { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
    .denominations input, .form-row input, .form-row select { width: 110px; font: inherit; padding: 6px; }
    .form-row input[type='text'] { width: auto; flex: 1; min-width: 200px; }
    .notes { width: 100%; font: inherit; padding: 8px; margin-bottom: 12px; box-sizing: border-box; }
  `,
})
export class SessionsPage {
  protected readonly register = inject(CashRegisterService);
  private readonly printer = inject(PrinterService);
  private readonly snack = inject(MatSnackBar);
  private readonly stockApi = inject(StockApiService);
  private readonly offline = inject(OfflineDataService);
  protected readonly device = inject(DeviceService).device;

  protected readonly denominations = FCFA_DENOMINATIONS;
  protected readonly depots = signal<Depot[]>([]);
  protected readonly z = signal<LocalZReport | null>(null);
  protected readonly counts = signal<Record<string, number>>({});
  protected readonly counted = computed(() => countDenominations(this.counts()));
  protected depot = '';
  protected openingFloat = 20000;
  protected movementKind: 'IN' | 'OUT' = 'OUT';
  protected movementAmount = 0;
  protected movementReason = '';
  protected notes = '';

  constructor() {
    this.stockApi.listDepots().pipe(catchError(() => from(this.offline.table('depots')).pipe(
      map((rows) => rows as unknown as Depot[])))).subscribe((depots) => {
      this.depots.set(depots.filter((d) => d.is_active));
      this.depot = this.device()?.depot && depots.some((d) => d.id === this.device()?.depot)
        ? this.device()!.depot! : defaultDepotId(depots) ?? '';
    });
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const session = await this.register.refresh();
    this.z.set(session ? await this.register.localZ(session) : null);
  }

  protected setCount(value: number, count: number): void {
    this.counts.update((c) => ({ ...c, [value]: Math.max(0, Math.trunc(Number(count) || 0)) }));
  }

  protected async open(): Promise<void> {
    await this.register.open(this.depot, Math.max(0, Number(this.openingFloat) || 0));
    this.snack.open('Caisse ouverte.');
    await this.refresh();
  }

  protected async addMovement(): Promise<void> {
    await this.register.movement(this.movementKind, Number(this.movementAmount), this.movementReason.trim());
    this.movementAmount = 0;
    this.movementReason = '';
    this.snack.open('Mouvement d’espèces enregistré.');
    await this.refresh();
  }

  protected async printX(): Promise<void> {
    const z = this.z();
    if (z) {
      const receipt = await this.register.zReceipt(z, 'X (intermédiaire)', null);
      await this.printer.print({ ...receipt, title: 'RAPPORT X' });
    }
  }

  protected async close(): Promise<void> {
    const z = this.z();
    if (!z || !confirm(`Clôturer la caisse avec ${this.counted()} FCFA comptés (attendu ${z.expectedCash}) ?`)) {
      return;
    }
    const result = await this.register.close(this.counted(), this.counts(), this.notes);
    await this.printer.print(await this.register.zReceipt(result.z, result.zNumber, result.counted));
    this.snack.open(`Caisse clôturée : rapport ${result.zNumber}.`);
    this.counts.set({});
    this.notes = '';
    await this.refresh();
  }
}
