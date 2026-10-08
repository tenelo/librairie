import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ManagedUser, Role, RoleCode, apiErrorMessage } from '@librairie/shared';
import { Observable } from 'rxjs';

import { AdminApiService } from '../../services/admin-api.service';

export interface UserDialogData {
  user?: ManagedUser;
  roles: Role[];
}

@Component({
  selector: 'bo-user-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.user ? 'Modifier ' + data.user.full_name : 'Nouvel utilisateur' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content class="fields">
        <mat-form-field>
          <mat-label>Identifiant</mat-label>
          <input matInput formControlName="username" autocomplete="off" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Rôle</mat-label>
          <mat-select formControlName="role">
            @for (role of data.roles; track role.code) {
              <mat-option [value]="role.code">{{ role.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Prénom</mat-label>
          <input matInput formControlName="first_name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Nom</mat-label>
          <input matInput formControlName="last_name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Téléphone</mat-label>
          <input matInput formControlName="phone" inputmode="tel" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>E-mail</mat-label>
          <input matInput formControlName="email" type="email" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ data.user ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe' }}</mat-label>
          <input matInput formControlName="password" type="password" autocomplete="new-password" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Durée max. hors ligne (h)</mat-label>
          <input matInput formControlName="offline_max_hours" type="number" min="1" />
          <mat-hint>Vide : valeur des paramètres</mat-hint>
        </mat-form-field>
        <mat-slide-toggle formControlName="must_change_password" class="full">
          Exiger un changement de mot de passe
        </mat-slide-toggle>
        @if (error()) {
          <p class="error full" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Annuler</button>
        <button mat-flat-button type="submit" [disabled]="form.invalid || saving()">Enregistrer</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      column-gap: 12px;
    }
    .full {
      grid-column: 1 / -1;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class UserDialogComponent {
  protected readonly data = inject<UserDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<UserDialogComponent, ManagedUser>);
  private readonly api = inject(AdminApiService);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).group({
    username: [this.data.user?.username ?? '', Validators.required],
    role: [(this.data.user?.role ?? 'CAISSIER') as RoleCode, Validators.required],
    first_name: [this.data.user?.first_name ?? ''],
    last_name: [this.data.user?.last_name ?? ''],
    phone: [this.data.user?.phone ?? ''],
    email: [this.data.user?.email ?? '', Validators.email],
    password: ['', this.data.user ? [] : [Validators.required, Validators.minLength(8)]],
    offline_max_hours: [this.data.user?.offline_max_hours ?? (null as number | null)],
    must_change_password: [this.data.user?.must_change_password ?? !this.data.user],
  });

  save(): void {
    const raw = this.form.getRawValue();
    const payload: Partial<ManagedUser> = {
      username: raw.username ?? '',
      role: raw.role ?? 'CAISSIER',
      first_name: raw.first_name ?? '',
      last_name: raw.last_name ?? '',
      phone: raw.phone || null,
      email: raw.email ?? '',
      offline_max_hours: raw.offline_max_hours || null,
      must_change_password: !!raw.must_change_password,
    };
    if (raw.password) {
      payload.password = raw.password;
    }
    this.saving.set(true);
    this.error.set(null);
    const request: Observable<ManagedUser> = this.data.user
      ? this.api.updateUser(this.data.user.id, payload)
      : this.api.createUser(payload);
    request.subscribe({
      next: (user) => this.ref.close(user),
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
