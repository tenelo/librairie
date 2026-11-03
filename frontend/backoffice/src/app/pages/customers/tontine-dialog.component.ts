import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import {
  ArticleLookup,
  CatalogApiService,
  FcfaPipe,
  OfflineDataService,
  SchoolYear,
  apiErrorMessage,
} from '@librairie/shared';

import { TONTINE_LABEL } from '../../features';
import { CashRegisterService } from '../sales/cash-register.service';

import { Tontine, TontinesApiService } from './tontines-api.service';

interface DraftLine {
  article: ArticleLookup;
  quantity: number;
}

/**
 * Nouvelle tontine : nom et prénoms du souscripteur, téléphone et souscription
 * (ex. 2 kits de 5ème + 3 livres de français de 3ème + 4 cahiers TP), aux prix du jour.
 */
@Component({
  selector: 'bo-tontine-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Nouvelle {{ label.toLowerCase() }}</h2>
    <mat-dialog-content>
      <div class="grid">
        <label class="field">
          <span>Nom et prénoms du souscripteur</span>
          <input type="text" [(ngModel)]="name" maxlength="150" placeholder="Konan Awa Marie" autocomplete="off" />
        </label>
        <label class="field">
          <span>Numéro de téléphone</span>
          <input type="tel" [(ngModel)]="phone" maxlength="20" placeholder="07 07 07 07 07" autocomplete="off" />
        </label>
        <label class="field">
          <span>Année scolaire</span>
          <select [(ngModel)]="schoolYear" aria-label="Année scolaire">
            @for (y of years(); track y.id) { <option [value]="y.id">{{ y.label }}</option> }
          </select>
        </label>
      </div>

      <h3>Souscription</h3>
      <input type="text" class="search" [(ngModel)]="term" (input)="search()"
             placeholder="Ajouter un kit, un livre, un cahier… (2 lettres minimum)" aria-label="Rechercher un article"
             autocomplete="off" />
      @if (results().length) {
        <ul class="results">
          @for (a of results(); track a.id) {
            <li><button type="button" (click)="addLine(a)">{{ a.name }} <small>{{ a.retail_price | fcfa }}</small></button></li>
          }
        </ul>
      }
      <table class="lines">
        @for (line of lines(); track line.article.id) {
          <tr>
            <td><input type="number" min="1" class="qty" [value]="line.quantity"
                       (change)="setQuantity(line, +$any($event.target).value)" [attr.aria-label]="'Quantité ' + line.article.name" /></td>
            <td>{{ line.article.name }}</td>
            <td class="num">{{ line.quantity * line.article.retail_price | fcfa }}</td>
            <td><button mat-icon-button type="button" (click)="removeLine(line)" aria-label="Retirer"><mat-icon>close</mat-icon></button></td>
          </tr>
        } @empty {
          <tr><td class="muted">Aucun article : recherchez puis cliquez pour ajouter.</td></tr>
        }
      </table>
      <p class="total">Montant à verser : <strong>{{ total() | fcfa }}</strong></p>
      <p class="muted">Les prix du jour sont gardés jusqu'au retrait des fournitures.</p>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Annuler</button>
      <button mat-flat-button type="button" (click)="save()" [disabled]="busy() || !canSave()">
        <mat-icon>savings</mat-icon> Enregistrer
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 12px; }
    .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .field > span { font-size: 13px; opacity: 0.8; }
    h3 { margin: 8px 0 4px; font-size: 16px; }
    input, select { font: inherit; padding: 8px; border: 1px solid var(--mat-sys-outline); border-radius: 8px;
      background: transparent; color: inherit; }
    .search { width: 100%; box-sizing: border-box; }
    .results { list-style: none; margin: 4px 0; padding: 0; max-height: 200px; overflow: auto;
      border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; }
    .results button { width: 100%; text-align: left; padding: 8px; border: 0; background: transparent; color: inherit;
      font: inherit; cursor: pointer; }
    .results button:hover { background: var(--mat-sys-surface-container); }
    .lines { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .lines td { padding: 4px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .qty { width: 64px; }
    .num { text-align: right; white-space: nowrap; }
    .total { text-align: right; font-size: 18px; margin-bottom: 0; }
    .muted { opacity: 0.75; font-size: 13px; }
    .error { color: var(--mat-sys-error); }
  `,
})
export class TontineDialogComponent {
  private readonly ref = inject(MatDialogRef<TontineDialogComponent, Tontine>);
  private readonly offline = inject(OfflineDataService);
  private readonly api = inject(TontinesApiService);
  private readonly register = inject(CashRegisterService);
  protected readonly label = TONTINE_LABEL;

  protected readonly years = signal<SchoolYear[]>([]);
  protected readonly results = signal<ArticleLookup[]>([]);
  protected readonly lines = signal<DraftLine[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected name = '';
  protected phone = '';
  protected term = '';
  protected schoolYear = '';

  constructor() {
    inject(CatalogApiService).listSchoolYears().subscribe((years) => {
      this.years.set(years);
      this.schoolYear = (years.find((y) => y.is_current) ?? years[0])?.id ?? '';
    });
  }

  protected readonly total = computed(() =>
    this.lines().reduce((sum, line) => sum + line.quantity * line.article.retail_price, 0));

  protected canSave(): boolean {
    return this.name.trim().length > 1 && this.lines().length > 0;
  }

  protected async search(): Promise<void> {
    const term = this.term.trim();
    this.results.set(term.length < 2 ? [] : (await this.offline.searchLocal(term, false, 12)).filter((a) => a.is_active));
  }

  protected addLine(article: ArticleLookup): void {
    const existing = this.lines().find((l) => l.article.id === article.id);
    if (existing) {
      this.setQuantity(existing, existing.quantity + 1);
    } else {
      this.lines.update((lines) => [...lines, { article, quantity: 1 }]);
    }
    this.term = '';
    this.results.set([]);
  }

  protected setQuantity(line: DraftLine, quantity: number): void {
    const value = Math.max(1, Math.floor(quantity) || 1);
    this.lines.update((lines) => lines.map((l) => (l === line ? { ...l, quantity: value } : l)));
  }

  protected removeLine(line: DraftLine): void {
    this.lines.update((lines) => lines.filter((l) => l !== line));
  }

  protected save(): void {
    if (!this.canSave()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.api.create({
      subscriber_name: this.name.trim(), subscriber_phone: this.phone.trim(), school_year: this.schoolYear || null,
      depot: this.register.current()?.depot,
      lines: this.lines().map((l) => ({ article: l.article.id, quantity: l.quantity })),
    }).subscribe({
      next: (tontine) => this.ref.close(tontine),
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
