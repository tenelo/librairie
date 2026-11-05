import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar } from '@angular/material/snack-bar';
import { APP_CONFIG, apiErrorMessage } from '@librairie/shared';

interface CodeRow {
  key: string;
  label: string;
  kind: 'document' | 'article';
  default_prefix: string;
  default_width: number;
  prefix: string;
  width: number;
  last_number: number;
  last_code: string | null;
  next_code: string;
}

/**
 * Administration › Codes et numérotation : préfixe et nombre de chiffres de chaque code généré par le
 * serveur. Les numéros eux-mêmes restent attribués automatiquement (compteurs non modifiables).
 */
@Component({
  selector: 'bo-codes-page',
  imports: [FormsModule, MatButtonModule, MatCardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Codes et numérotation</h1>
    <p class="help">
      Les codes sont attribués automatiquement par le serveur, sans doublon possible. Vous pouvez changer le
      <strong>préfixe</strong> et le <strong>nombre de chiffres</strong> : seuls les nouveaux codes sont concernés,
      et un nouveau préfixe repart à 1. Les numéros déjà émis ne changent jamais.
    </p>

    <table class="list">
      <thead>
        <tr><th>Document</th><th>Format</th><th>Préfixe</th><th>Chiffres</th><th>Dernier émis</th><th>Prochain</th><th></th></tr>
      </thead>
      <tbody>
        @for (r of rows(); track r.key) {
          <tr>
            <td><strong>{{ r.label }}</strong></td>
            <td><small class="muted">{{ r.kind === 'document' ? 'PRÉFIXE-ANNÉE-N° (repart à 1 chaque année)' : 'PRÉFIXE-N°' }}</small></td>
            <td><input class="prefix" [(ngModel)]="drafts[r.key].prefix" maxlength="6" [attr.aria-label]="'Préfixe ' + r.label" /></td>
            <td><input class="width" type="number" min="3" max="8" [(ngModel)]="drafts[r.key].width"
                       [attr.aria-label]="'Nombre de chiffres ' + r.label" /></td>
            <td><code>{{ r.last_code ?? '—' }}</code></td>
            <td><code>{{ r.next_code }}</code></td>
            <td class="actions">
              @if (changed(r)) {
                <button mat-flat-button type="button" (click)="save(r)" [disabled]="saving()">Enregistrer</button>
              }
              @if (r.prefix !== r.default_prefix || r.width !== r.default_width) {
                <button mat-button type="button" (click)="reset(r)" [disabled]="saving()"
                        [title]="'Revenir à ' + r.default_prefix + ', ' + r.default_width + ' chiffres'">Par défaut</button>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>

    <mat-card appearance="outlined" class="fixed">
      <mat-card-header><mat-card-title>Codes non modifiables ici</mat-card-title></mat-card-header>
      <mat-card-content>
        <table class="list">
          <thead><tr><th>Code</th><th>Exemple</th><th>Signification</th><th>Où le régler</th></tr></thead>
          <tbody>
            <tr><td>Reçu de vente</td><td><code>C01-20261104-0005</code></td>
              <td>Caisse C01, date du 04/11/2026, 5ᵉ reçu du jour sur cette caisse (créé sur le poste, même hors connexion)</td>
              <td>Code du terminal : Administration › Terminaux</td></tr>
            <tr><td>Rapport caisse</td><td><code>Z-C01-20261104</code></td>
              <td>Clôture de la caisse C01 le 04/11/2026</td><td>Code du terminal : Administration › Terminaux</td></tr>
            <tr><td>Versement de tontine</td><td><code>TS-2026-00001-V02</code></td>
              <td>2ᵉ versement de la souscription TS-2026-00001</td><td>Suit le code de la souscription (ci-dessus)</td></tr>
            <tr><td>Code-barres interne</td><td><code>2000000000015</code></td>
              <td>EAN-13 commençant par 20 (plage réservée à l'usage interne), donné aux articles sans code-barres fournisseur</td>
              <td>Automatique (norme EAN-13)</td></tr>
          </tbody>
        </table>
      </mat-card-content>
    </mat-card>
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .help { opacity: 0.8; max-width: 860px; }
    .prefix { width: 80px; text-transform: uppercase; font: inherit; padding: 4px; }
    .width { width: 56px; font: inherit; padding: 4px; }
    .actions { white-space: nowrap; text-align: right; }
    .fixed { margin-top: 24px; }
    code { font-size: 13px; }
  `,
})
export class CodesPage {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/settings/codes/`;
  private readonly snack = inject(MatSnackBar);
  protected readonly rows = signal<CodeRow[]>([]);
  protected readonly saving = signal(false);
  protected drafts: Record<string, { prefix: string; width: number }> = {};

  constructor() {
    this.load();
  }

  protected changed(row: CodeRow): boolean {
    const d = this.drafts[row.key];
    return !!d && ((d.prefix ?? '').trim().toUpperCase() !== row.prefix || Number(d.width) !== row.width);
  }

  protected save(row: CodeRow): void {
    const d = this.drafts[row.key];
    this.patch(row, { prefix: (d.prefix ?? '').trim().toUpperCase(), width: Number(d.width) });
  }

  protected reset(row: CodeRow): void {
    this.patch(row, { prefix: row.default_prefix, width: row.default_width });
  }

  private patch(row: CodeRow, body: { prefix: string; width: number }): void {
    this.saving.set(true);
    this.http.patch<CodeRow>(`${this.api}${row.key}/`, body).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.rows.update((rows) => rows.map((r) => (r.key === updated.key ? updated : r)));
        this.drafts[updated.key] = { prefix: updated.prefix, width: updated.width };
        this.snack.open(`Codes « ${updated.label} » : prochain ${updated.next_code}.`);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
      },
    });
  }

  private load(): void {
    this.http.get<CodeRow[]>(this.api).subscribe({
      next: (rows) => {
        this.drafts = Object.fromEntries(rows.map((r) => [r.key, { prefix: r.prefix, width: r.width }]));
        this.rows.set(rows);
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 }),
    });
  }
}
