import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { APP_CONFIG, apiErrorMessage } from '@librairie/shared';

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

/** Moyens de paiement proposés à la caisse (activation, libellé, référence obligatoire, ordre). */
@Component({
  selector: 'bo-payment-methods-page',
  imports: [FormsModule, MatButtonModule, MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Moyens de paiement</h1>
    <table class="list">
      <thead><tr><th>Code</th><th>Libellé</th><th>Type</th><th>Référence obligatoire</th><th>Actif</th><th>Ordre</th><th></th></tr></thead>
      <tbody>
        @for (m of methods(); track m.code) {
          <tr>
            <td><code>{{ m.code }}</code></td>
            <td><input [(ngModel)]="m.label" aria-label="Libellé" /></td>
            <td>{{ m.kind_label }}</td>
            <td><mat-slide-toggle [(ngModel)]="m.requires_reference" aria-label="Référence obligatoire" /></td>
            <td><mat-slide-toggle [(ngModel)]="m.is_active" aria-label="Actif" /></td>
            <td><input type="number" [(ngModel)]="m.sort_order" class="small" aria-label="Ordre" /></td>
            <td><button mat-stroked-button type="button" (click)="save(m)">Enregistrer</button></td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `input { font: inherit; padding: 6px; } .small { width: 70px; }`,
})
export class PaymentMethodsPage {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/sales/payment-methods/`;
  private readonly snack = inject(MatSnackBar);
  protected readonly methods = signal<PaymentMethod[]>([]);

  constructor() {
    this.http.get<PaymentMethod[]>(this.api).subscribe((methods) => this.methods.set(methods));
  }

  protected save(method: PaymentMethod): void {
    this.http.patch(`${this.api}${method.id}/`, { label: method.label, requires_reference: method.requires_reference,
      is_active: method.is_active, sort_order: method.sort_order }).subscribe({
      next: () => this.snack.open(`${method.label} enregistré.`),
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
    });
  }
}
