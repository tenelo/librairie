import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { FcfaPipe, KitAdjustmentsInput, KitPricingInput, customizeKit } from '@librairie/shared';

export interface KitComponentView {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  substitutes: { id: string; name: string; unitPrice: number }[];
}

export interface KitCustomizeData {
  kitName: string;
  components: KitComponentView[];
  pricing: Omit<KitPricingInput, 'components'>;
  current: KitAdjustmentsInput | null;
}

export interface KitCustomizeResult {
  adjustments: KitAdjustmentsInput | null;
  price: number;
}

/** Personnalisation d'un kit à la vente : retrait d'articles déjà possédés, substitution par un équivalent. */
@Component({
  selector: 'bo-kit-customize-dialog',
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Personnaliser « {{ data.kitName }} »</h2>
    <mat-dialog-content>
      <table>
        <thead><tr><th>Garder</th><th>Article</th><th>Remplacer par</th></tr></thead>
        <tbody>
          @for (c of data.components; track c.id) {
            <tr [class.removed]="removed().has(c.id)">
              <td><mat-checkbox [checked]="!removed().has(c.id)" (change)="toggle(c.id, $event.checked)"
                                [aria-label]="'Garder ' + c.name" /></td>
              <td>{{ c.quantity }} × {{ c.name }} <small>({{ c.unitPrice | fcfa }})</small></td>
              <td>
                @if (c.substitutes.length && !removed().has(c.id)) {
                  <select [value]="substitutions()[c.id] || ''" (change)="substitute(c.id, $any($event.target).value)"
                          [attr.aria-label]="'Équivalent de ' + c.name">
                    <option value="">—</option>
                    @for (s of c.substitutes; track s.id) {
                      <option [value]="s.id">{{ s.name }} ({{ s.unitPrice | fcfa }})</option>
                    }
                  </select>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      <p class="price">Prix du kit : <s>{{ result().basePrice | fcfa }}</s> → <strong>{{ result().price | fcfa }}</strong></p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="reset()">Kit complet</button>
      <button mat-button type="button" mat-dialog-close>Annuler</button>
      <button mat-flat-button type="button" (click)="apply()">Appliquer</button>
    </mat-dialog-actions>
  `,
  styles: `
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 4px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .removed td:nth-child(2) { text-decoration: line-through; opacity: 0.6; }
    select { font: inherit; padding: 4px; }
    .price { font-size: 18px; margin-top: 12px; }
  `,
})
export class KitCustomizeDialogComponent {
  protected readonly data = inject<KitCustomizeData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<KitCustomizeDialogComponent, KitCustomizeResult>);
  protected readonly removed = signal(new Set(this.data.current?.removed ?? []));
  protected readonly substitutions = signal<Record<string, string>>({ ...(this.data.current?.substitutions ?? {}) });

  protected readonly result = computed(() => customizeKit({
    ...this.data.pricing,
    components: this.data.components.map((c) => ({ id: c.id, unitPrice: c.unitPrice, unitCost: 0, quantity: c.quantity,
      substitutes: c.substitutes.map((s) => ({ id: s.id, unitPrice: s.unitPrice })) })),
  }, [...this.removed()], this.substitutions()));

  protected toggle(id: string, keep: boolean): void {
    this.removed.update((set) => {
      const next = new Set(set);
      if (keep) {
        next.delete(id);
      } else {
        next.add(id);
        this.substitute(id, '');
      }
      return next;
    });
  }

  protected substitute(id: string, articleId: string): void {
    this.substitutions.update((map) => {
      const next = { ...map };
      if (articleId) {
        next[id] = articleId;
      } else {
        delete next[id];
      }
      return next;
    });
  }

  protected reset(): void {
    this.ref.close({ adjustments: null, price: this.result().basePrice });
  }

  protected apply(): void {
    const removed = [...this.removed()];
    const substitutions = this.substitutions();
    const changed = removed.length > 0 || Object.keys(substitutions).length > 0;
    this.ref.close({ adjustments: changed ? { removed, substitutions } : null, price: this.result().price });
  }
}
