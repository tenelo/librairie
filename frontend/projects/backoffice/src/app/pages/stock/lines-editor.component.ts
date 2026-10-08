import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ArticleLookup, FcfaPipe } from '@librairie/shared';

import { ArticlePickerComponent } from '../catalog/article-picker.component';

export interface EditableLine {
  article: string;
  code: string;
  name: string;
  quantity: number;
  unitCost: number;
  /** Réception sur commande : ligne de bon de commande et reliquat attendu. */
  orderLine?: string | null;
  expected?: number;
}

/** Ajoute un article (ou incrémente sa quantité s'il est déjà présent, ex. scans successifs). */
export function addOrIncrement(lines: EditableLine[], article: ArticleLookup, unitCost: number): EditableLine[] {
  const existing = lines.find((line) => line.article === article.id && !line.orderLine);
  const onOrder = lines.find((line) => line.article === article.id && line.orderLine);
  const target = onOrder ?? existing;
  if (target) {
    return lines.map((line) => (line === target ? { ...line, quantity: line.quantity + 1 } : line));
  }
  return [...lines, { article: article.id, code: article.code, name: article.name, quantity: 1, unitCost }];
}

export function linesTotal(lines: EditableLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
}

/** Saisie de lignes (transferts, bons de commande, réceptions) avec recherche et scan. */
@Component({
  selector: 'bo-lines-editor',
  imports: [MatButtonModule, MatIconModule, FcfaPipe, ArticlePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!readonly()) {
      <bo-article-picker label="Ajouter un article (nom, code ou scan)" (picked)="add($event)" />
    }
    <div class="table-wrapper">
      <table class="lines">
        <thead>
          <tr>
            <th>Article</th>
            @if (showExpected()) {
              <th class="num">Attendu</th>
            }
            <th class="num">Quantité</th>
            @if (showCost()) {
              <th class="num">Prix unitaire</th>
              <th class="num">Montant</th>
            }
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (line of lines(); track $index) {
            <tr [class.short]="showExpected() && line.expected !== undefined && line.quantity < line.expected">
              <td><code>{{ line.code }}</code> {{ line.name }}</td>
              @if (showExpected()) {
                <td class="num">{{ line.expected ?? '—' }}</td>
              }
              <td class="num">
                @if (readonly()) {
                  {{ line.quantity }}
                } @else {
                  <input type="number" min="0" [value]="line.quantity" (change)="update($index, 'quantity', $any($event.target).value)"
                         [attr.aria-label]="'Quantité de ' + line.name" />
                }
              </td>
              @if (showCost()) {
                <td class="num">
                  @if (readonly()) {
                    {{ line.unitCost | fcfa }}
                  } @else {
                    <input type="number" min="0" [value]="line.unitCost" (change)="update($index, 'unitCost', $any($event.target).value)"
                           [attr.aria-label]="'Prix unitaire de ' + line.name" />
                  }
                </td>
                <td class="num">{{ line.quantity * line.unitCost | fcfa }}</td>
              }
              <td class="num">
                @if (!readonly()) {
                  <button mat-icon-button type="button" (click)="remove($index)" aria-label="Retirer la ligne"><mat-icon>delete</mat-icon></button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td [attr.colspan]="6" class="empty">Aucune ligne : recherchez ou scannez un article.</td></tr>
          }
        </tbody>
        @if (showCost() && lines().length) {
          <tfoot>
            <tr><td [attr.colspan]="showExpected() ? 4 : 3" class="num">Total</td><td class="num"><strong>{{ total() | fcfa }}</strong></td><td></td></tr>
          </tfoot>
        }
      </table>
    </div>
  `,
  styles: `
    .lines {
      width: 100%;
      border-collapse: collapse;
    }
    .lines th,
    .lines td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: left;
    }
    .num {
      text-align: right !important;
      white-space: nowrap;
    }
    input {
      width: 96px;
      padding: 6px;
      font: inherit;
      text-align: right;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
      background: transparent;
      color: inherit;
    }
    .short {
      background: rgba(239, 108, 0, 0.08);
    }
    .empty {
      text-align: center;
      opacity: 0.7;
      padding: 16px;
    }
  `,
})
export class LinesEditorComponent {
  readonly lines = model<EditableLine[]>([]);
  readonly showCost = input(false);
  readonly showExpected = input(false);
  readonly readonly = input(false);
  /** Coût proposé pour un article ajouté (par défaut son CMP). */
  readonly costOf = input<(article: ArticleLookup) => number>((article) => article.avg_cost);

  protected readonly total = computed(() => linesTotal(this.lines()));

  protected add(article: ArticleLookup): void {
    this.lines.set(addOrIncrement(this.lines(), article, this.costOf()(article)));
  }

  protected update(index: number, field: 'quantity' | 'unitCost', raw: string): void {
    const value = Math.max(0, Math.trunc(Number(raw) || 0));
    this.lines.set(this.lines().map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  }

  protected remove(index: number): void {
    this.lines.set(this.lines().filter((_, i) => i !== index));
  }
}
