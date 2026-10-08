import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ArticleLookup, BarcodeSvgComponent, FcfaPipe } from '@librairie/shared';

import { ArticlePickerComponent } from './article-picker.component';

export type LabelFormat = 'A4_24' | 'ROLL_50x30';

export interface LabelLine {
  article: ArticleLookup;
  copies: number;
}

export interface PrintedLabel {
  key: string;
  name: string;
  code: string;
  barcode: string | null;
  price: number;
}

/** Développe la liste (article × nombre d'exemplaires) en étiquettes individuelles. */
export function expandLabels(lines: LabelLine[]): PrintedLabel[] {
  return lines.flatMap((line) =>
    Array.from({ length: Math.max(0, line.copies) }, (_, index) => ({
      key: `${line.article.id}-${index}`,
      name: line.article.name,
      code: line.article.code,
      barcode: line.article.barcode,
      price: line.article.retail_price,
    })),
  );
}

/**
 * Étiquettes codes-barres : planche A4 de 24 étiquettes (70 × 37 mm) ou rouleau thermique
 * 50 × 30 mm. L'impression passe par le navigateur (fonctionne hors connexion).
 */
@Component({
  selector: 'bo-labels-page',
  imports: [FormsModule, MatCardModule, MatButtonModule, MatButtonToggleModule, MatIconModule, MatSlideToggleModule,
    FcfaPipe, BarcodeSvgComponent, ArticlePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="no-print">
      <header class="page-header">
        <h1>Étiquettes codes-barres</h1>
        <button mat-flat-button type="button" (click)="print()" [disabled]="!labels().length">
          <mat-icon>print</mat-icon> Imprimer {{ labels().length }} étiquette(s)
        </button>
      </header>

      <mat-card appearance="outlined">
        <mat-card-content class="settings">
          <bo-article-picker label="Ajouter un article (nom, code ou scan)" [excludeKits]="false" (picked)="add($event)" />
          <mat-button-toggle-group [value]="format()" (change)="format.set($event.value)" aria-label="Format">
            <mat-button-toggle value="A4_24">Planche A4 (24 étiquettes)</mat-button-toggle>
            <mat-button-toggle value="ROLL_50x30">Rouleau 50 × 30 mm</mat-button-toggle>
          </mat-button-toggle-group>
          <mat-slide-toggle [checked]="showPrice()" (change)="showPrice.set($event.checked)">Afficher le prix</mat-slide-toggle>
        </mat-card-content>
      </mat-card>

      <table class="lines">
        <thead><tr><th>Article</th><th>Code-barres</th><th>Exemplaires</th><th></th></tr></thead>
        <tbody>
          @for (line of lines(); track line.article.id) {
            <tr>
              <td><code>{{ line.article.code }}</code> {{ line.article.name }}</td>
              <td><code>{{ line.article.barcode ?? 'aucun : le code interne sera imprimé en texte' }}</code></td>
              <td>
                <input type="number" min="1" max="500" [value]="line.copies" class="copies"
                       (change)="setCopies(line, $any($event.target).value)" [attr.aria-label]="'Exemplaires de ' + line.article.name" />
              </td>
              <td><button mat-icon-button type="button" (click)="remove(line)" aria-label="Retirer"><mat-icon>delete</mat-icon></button></td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="empty">Ajoutez des articles à étiqueter.</td></tr>
          }
        </tbody>
      </table>
      @if (labels().length) {
        <h2>Aperçu</h2>
      }
    </div>

    <section class="sheet" [class.a4]="format() === 'A4_24'" [class.roll]="format() === 'ROLL_50x30'">
      @for (label of labels(); track label.key) {
        <div class="label">
          <div class="name">{{ label.name }}</div>
          @if (label.barcode) {
            <lib-barcode-svg class="bars" [code]="label.barcode" [height]="34" />
          } @else {
            <div class="bars text">{{ label.code }}</div>
          }
          @if (showPrice()) {
            <div class="price">{{ label.price | fcfa }}</div>
          }
        </div>
      }
    </section>
  `,
  styleUrl: './catalog-page.scss',
  styles: `
    .settings {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .lines {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .lines th,
    .lines td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .copies {
      width: 72px;
      padding: 6px;
      font: inherit;
    }
    .sheet {
      display: grid;
      gap: 0;
      background: #fff;
      color: #000;
    }
    .sheet.a4 {
      width: 210mm;
      grid-template-columns: repeat(3, 70mm);
      grid-auto-rows: 37mm;
    }
    .sheet.roll {
      width: 50mm;
      grid-template-columns: 50mm;
      grid-auto-rows: 30mm;
    }
    .label {
      box-sizing: border-box;
      padding: 2mm 3mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      overflow: hidden;
      border: 1px dashed #ccc;
      break-inside: avoid;
    }
    .name {
      font-size: 8pt;
      line-height: 1.1;
      text-align: center;
      max-height: 2.2em;
      overflow: hidden;
    }
    .bars {
      width: 100%;
      flex: 1;
      min-height: 0;
    }
    .bars.text {
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      font-size: 11pt;
    }
    .price {
      font-size: 10pt;
      font-weight: 700;
    }
    @media print {
      .no-print {
        display: none;
      }
      .label {
        border: none;
      }
    }
  `,
})
export class LabelsPage {
  protected readonly lines = signal<LabelLine[]>([]);
  protected readonly format = signal<LabelFormat>('A4_24');
  protected readonly showPrice = signal(true);
  protected readonly labels = computed(() => expandLabels(this.lines()));

  protected add(article: ArticleLookup): void {
    const existing = this.lines().find((line) => line.article.id === article.id);
    if (existing) {
      this.setCopies(existing, existing.copies + 1);
    } else {
      this.lines.update((lines) => [...lines, { article, copies: 1 }]);
    }
  }

  protected setCopies(line: LabelLine, copies: number | string): void {
    const value = Math.min(500, Math.max(1, Math.trunc(Number(copies) || 1)));
    this.lines.update((lines) => lines.map((l) => (l.article.id === line.article.id ? { ...l, copies: value } : l)));
  }

  protected remove(line: LabelLine): void {
    this.lines.update((lines) => lines.filter((l) => l.article.id !== line.article.id));
  }

  protected print(): void {
    window.print();
  }
}
