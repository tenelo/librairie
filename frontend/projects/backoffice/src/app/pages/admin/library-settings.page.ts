import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LibrarySettings, apiErrorMessage } from '@librairie/shared';

import { AdminApiService } from '../../services/admin-api.service';

/** Paramètres de la librairie : identité, mentions des reçus, délais et synchronisation. */
@Component({
  selector: 'bo-library-settings-page',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatProgressBarModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Paramètres librairie et reçus</h1>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>Identité</mat-card-title></mat-card-header>
        <mat-card-content class="grid">
          <mat-form-field><mat-label>Nom</mat-label><input matInput formControlName="name" /></mat-form-field>
          <mat-form-field><mat-label>Ville</mat-label><input matInput formControlName="city" /></mat-form-field>
          <mat-form-field class="wide"><mat-label>Adresse</mat-label><input matInput formControlName="address" /></mat-form-field>
          <mat-form-field><mat-label>Téléphone</mat-label><input matInput formControlName="phone" /></mat-form-field>
          <mat-form-field><mat-label>E-mail</mat-label><input matInput formControlName="email" type="email" /></mat-form-field>
          <mat-form-field><mat-label>Site web</mat-label><input matInput formControlName="website" /></mat-form-field>
          <mat-form-field>
            <mat-label>N° compte contribuable</mat-label><input matInput formControlName="taxpayer_number" />
          </mat-form-field>
          <mat-form-field><mat-label>RCCM</mat-label><input matInput formControlName="trade_register" /></mat-form-field>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>Reçus et TVA</mat-card-title></mat-card-header>
        <mat-card-content class="grid">
          <mat-form-field class="wide">
            <mat-label>En-tête du reçu</mat-label><textarea matInput rows="2" formControlName="receipt_header"></textarea>
          </mat-form-field>
          <mat-form-field class="wide">
            <mat-label>Pied de page du reçu</mat-label><textarea matInput rows="2" formControlName="receipt_footer"></textarea>
          </mat-form-field>
          <mat-slide-toggle formControlName="vat_enabled">TVA activée</mat-slide-toggle>
          <mat-form-field>
            <mat-label>Taux de TVA par défaut (%)</mat-label>
            <input matInput formControlName="default_vat_rate" type="number" min="0" max="100" step="0.01" />
          </mat-form-field>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>Délais et synchronisation</mat-card-title></mat-card-header>
        <mat-card-content class="grid">
          <mat-form-field>
            <mat-label>Durée max. hors ligne (h)</mat-label>
            <input matInput formControlName="offline_max_hours" type="number" min="1" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Délai de retrait des commandes (h)</mat-label>
            <input matInput formControlName="order_expiry_hours" type="number" min="1" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Intervalle de synchronisation (min)</mat-label>
            <input matInput formControlName="sync_interval_minutes" type="number" min="1" max="120" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Points de fidélité / 1 000 FCFA</mat-label>
            <input matInput formControlName="loyalty_points_per_1000" type="number" min="0" />
          </mat-form-field>
        </mat-card-content>
      </mat-card>

      <div class="actions">
        <button mat-flat-button type="submit" [disabled]="form.invalid || form.pristine || saving()">
          Enregistrer
        </button>
      </div>
    </form>
  `,
  styles: `
    mat-card {
      margin-bottom: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      column-gap: 12px;
      align-items: center;
      padding-top: 12px;
    }
    .wide {
      grid-column: 1 / -1;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
    }
  `,
})
export class LibrarySettingsPage {
  private readonly api = inject(AdminApiService);
  private readonly snack = inject(MatSnackBar);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    city: [''],
    address: [''],
    phone: [''],
    email: ['', Validators.email],
    website: [''],
    taxpayer_number: [''],
    trade_register: [''],
    receipt_header: [''],
    receipt_footer: [''],
    vat_enabled: [false],
    default_vat_rate: ['18.00'],
    offline_max_hours: [72, [Validators.required, Validators.min(1)]],
    order_expiry_hours: [72, [Validators.required, Validators.min(1)]],
    sync_interval_minutes: [5, [Validators.required, Validators.min(1), Validators.max(120)]],
    loyalty_points_per_1000: [1, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    this.api.getSettings().subscribe({
      next: (settings) => this.fill(settings),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected save(): void {
    this.saving.set(true);
    this.api.updateSettings(this.form.getRawValue()).subscribe({
      next: (settings) => {
        this.saving.set(false);
        this.fill(settings);
        this.snack.open('Paramètres enregistrés.');
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fill(settings: LibrarySettings): void {
    this.form.reset({
      name: settings.name,
      city: settings.city,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      taxpayer_number: settings.taxpayer_number,
      trade_register: settings.trade_register,
      receipt_header: settings.receipt_header,
      receipt_footer: settings.receipt_footer,
      vat_enabled: settings.vat_enabled,
      default_vat_rate: settings.default_vat_rate,
      offline_max_hours: settings.offline_max_hours,
      order_expiry_hours: settings.order_expiry_hours,
      sync_interval_minutes: settings.sync_interval_minutes,
      loyalty_points_per_1000: settings.loyalty_points_per_1000,
    });
    this.loading.set(false);
  }

  private fail(err: unknown): void {
    this.loading.set(false);
    this.saving.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
  }
}
