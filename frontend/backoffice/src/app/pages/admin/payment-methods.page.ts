import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { APP_CONFIG, apiErrorMessage } from '@librairie/shared';
import { firstValueFrom } from 'rxjs';
import { ONLINE_SALES_ENABLED } from '../../features';

interface PaymentMethod {
  id?: string;
  code: string;
  label: string;
  kind: string;
  kind_label?: string;
  requires_reference: boolean;
  is_active: boolean;
  sort_order: number;
}

/** Écart entre deux positions : laisse de la place pour insérer un moyen plus tard sans tout renuméroter. */
const ORDER_STEP = 10;

/**
 * Moyens de paiement proposés à la caisse (activation, libellé, référence obligatoire, ordre d'affichage).
 * L'ordre se règle en glissant les lignes (enregistré aussitôt) ou en saisissant un numéro.
 */
@Component({
  selector: 'bo-payment-methods-page',
  imports: [FormsModule, DragDropModule, MatButtonModule, MatIconModule, MatSlideToggleModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Moyens de paiement</h1>
    <p class="help">
      Glissez une ligne avec la poignée <mat-icon inline>drag_indicator</mat-icon> pour changer l'ordre d'affichage à la caisse :
      il est enregistré aussitôt. Vous pouvez aussi saisir un numéro, puis cliquer sur « Enregistrer ».
    </p>
    <table class="list">
      <thead>
        <tr>
          <th aria-label="Déplacer"></th><th>Code</th><th>Libellé</th><th>Type</th><th>Référence obligatoire</th><th>Actif</th>
          <th>Ordre d'affichage</th><th></th>
        </tr>
      </thead>
      <tbody cdkDropList [cdkDropListData]="methods()" (cdkDropListDropped)="drop($event)" [cdkDropListDisabled]="saving()">
        @for (m of methods(); track m.code) {
          <tr cdkDrag cdkDragLockAxis="y" [class.inactive]="!m.is_active">
            <td class="handle" cdkDragHandle matTooltip="Glisser pour déplacer">
              <mat-icon>drag_indicator</mat-icon>
            </td>
            <td><code>{{ m.code }}</code></td>
            <td><input [(ngModel)]="m.label" aria-label="Libellé" /></td>
            <td>{{ m.kind_label }}</td>
            <td><mat-slide-toggle [(ngModel)]="m.requires_reference" aria-label="Référence obligatoire" /></td>
            <td><mat-slide-toggle [(ngModel)]="m.is_active" aria-label="Actif" /></td>
            <td><input type="number" [(ngModel)]="m.sort_order" class="small" aria-label="Ordre d'affichage" /></td>
            <td><button mat-stroked-button type="button" (click)="save(m)" [disabled]="saving()">Enregistrer</button></td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    input { font: inherit; padding: 6px; }
    .small { width: 70px; }
    .help { opacity: 0.8; }
    .handle { cursor: grab; width: 32px; opacity: 0.7; }
    .inactive { opacity: 0.55; }
    .cdk-drag-preview { background: var(--mat-sys-surface-container-high); box-shadow: 0 4px 16px rgb(0 0 0 / 20%);
      display: table; }
    .cdk-drag-placeholder { opacity: 0.3; }
    .cdk-drop-list-dragging tr:not(.cdk-drag-placeholder) { transition: transform 200ms ease; }
  `,
})
export class PaymentMethodsPage {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/sales/payment-methods/`;
  private readonly snack = inject(MatSnackBar);
  protected readonly methods = signal<PaymentMethod[]>([]);
  protected readonly saving = signal(false);

  constructor() {
    // L'acompte en ligne n'existe qu'avec la vente en ligne (features.ts).
    this.http.get<PaymentMethod[]>(this.api).subscribe((methods) =>
      this.methods.set(
        methods
          .filter((m) => ONLINE_SALES_ENABLED || m.kind !== 'DEPOSIT')
          .sort((a, b) => a.sort_order - b.sort_order),
      ),
    );
  }

  protected save(method: PaymentMethod): void {
    this.http.patch(`${this.api}${method.id}/`, { label: method.label, requires_reference: method.requires_reference,
      is_active: method.is_active, sort_order: method.sort_order }).subscribe({
      next: () => {
        this.methods.update((list) => [...list].sort((a, b) => a.sort_order - b.sort_order));
        this.snack.open(`${method.label} enregistré.`);
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
    });
  }

  /** Glisser-déposer : renumérote 10, 20, 30… et enregistre l'ordre des seules lignes qui ont changé. */
  protected async drop(event: CdkDragDrop<PaymentMethod[]>): Promise<void> {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    const list = [...this.methods()];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    const changed: PaymentMethod[] = [];
    list.forEach((m, index) => {
      const order = (index + 1) * ORDER_STEP;
      if (m.sort_order !== order) {
        m.sort_order = order;
        changed.push(m);
      }
    });
    this.methods.set(list);

    this.saving.set(true);
    try {
      for (const m of changed) {
        await firstValueFrom(this.http.patch(`${this.api}${m.id}/`, { sort_order: m.sort_order }));
      }
      this.snack.open('Ordre d\'affichage enregistré.');
    } catch (err: unknown) {
      this.snack.open(apiErrorMessage(err), 'Fermer');
    } finally {
      this.saving.set(false);
    }
  }
}
