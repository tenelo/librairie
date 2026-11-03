import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LocalDbService, OutboxService, SyncedRow } from '@librairie/shared';

import { PosService } from './pos.service';

/** Création rapide d'un client à la caisse (hors connexion possible : UUID local, outbox). */
@Component({
  selector: 'bo-quick-customer-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Nouveau client</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content class="fields">
        <mat-form-field><mat-label>Nom</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>Téléphone</mat-label><input matInput formControlName="phone" inputmode="tel" /></mat-form-field>
        <mat-form-field><mat-label>E-mail</mat-label><input matInput formControlName="email" type="email" /></mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Annuler</button>
        <button mat-flat-button type="submit" [disabled]="form.invalid">Créer</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `.fields { display: flex; flex-direction: column; }`,
})
export class QuickCustomerDialogComponent {
  private readonly data = inject<{ name: string }>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<QuickCustomerDialogComponent, SyncedRow>);
  private readonly local = inject(LocalDbService);
  private readonly outbox = inject(OutboxService);
  private readonly pos = inject(PosService);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.data.name ?? '', Validators.required],
    phone: ['', Validators.pattern(/^\+?[0-9 ]{8,20}$/)],
    email: ['', Validators.email],
  });

  protected async save(): Promise<void> {
    const value = this.form.getRawValue();
    const id = crypto.randomUUID();
    const row: SyncedRow = { id, sync_version: 0, is_deleted: false, ...value, credit_balance: 0, credit_limit: 0,
      loyalty_points: 0, is_active: true };
    await this.local.db.customers.put(row);
    await this.outbox.enqueue('customer', 'create', { id, ...value }, { label: `Nouveau client ${value.name}` });
    await this.pos.afterWrite();
    this.ref.close(row);
  }
}
