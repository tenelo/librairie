import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Library, ManagedUser, Role, RoleCode, StockApiService, apiErrorMessage } from '@librairie/shared';
import { Observable } from 'rxjs';

import { AdminApiService } from '../../services/admin-api.service';

/** Mots courts et faciles à dicter ; l'utilisateur change son mot de passe à la première connexion. */
const PASSWORD_WORDS = ['Cahier', 'Stylo', 'Livre', 'Crayon', 'Gomme', 'Classeur', 'Ardoise', 'Compas', 'Feutre',
  'Agenda', 'Carnet', 'Trousse'];

/** Mot de passe simple : un mot + tiret + 4 chiffres (ex. « Cahier-4827 »), tiré au hasard. */
export function generatePassword(): string {
  const random = new Uint32Array(2);
  crypto.getRandomValues(random);
  const word = PASSWORD_WORDS[random[0] % PASSWORD_WORDS.length];
  return `${word}-${String(1000 + (random[1] % 9000))}`;
}

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
    MatIconModule,
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
        <mat-form-field subscriptSizing="dynamic" class="full">
          <mat-label>Librairie</mat-label>
          <mat-select formControlName="library">
            <mat-option [value]="null">— Toutes les librairies —</mat-option>
            @for (l of libraries(); track l.id) {
              <mat-option [value]="l.id" [disabled]="!l.is_active">{{ l.name }}@if (l.location) { · {{ l.location }} }</mat-option>
            }
          </mat-select>
          <mat-hint>
            @if (form.controls.role.value === 'ADMIN') { L'administrateur voit toutes les librairies. }
            @else { L'employé ne verra que cette librairie. }
          </mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Nom</mat-label>
          <input matInput formControlName="last_name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Prénom</mat-label>
          <input matInput formControlName="first_name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Téléphone</mat-label>
          <input matInput formControlName="phone" inputmode="tel" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>E-mail</mat-label>
          <input matInput formControlName="email" type="email" />
        </mat-form-field>
        <mat-form-field [subscriptSizing]="data.user ? 'fixed' : 'dynamic'">
          <mat-label>{{ data.user ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe' }}</mat-label>
          <!-- Création : mot de passe proposé, visible pour être communiqué à l'utilisateur. -->
          <input matInput formControlName="password" [type]="data.user ? 'password' : 'text'" autocomplete="new-password" />
          @if (!data.user) {
            <span matSuffix class="password-actions">
              <button mat-icon-button type="button" (click)="copyPassword()" aria-label="Copier le mot de passe"
                      title="Copier"><mat-icon>content_copy</mat-icon></button>
              <button mat-icon-button type="button" (click)="newPassword()" aria-label="Générer un autre mot de passe"
                      title="Générer un autre"><mat-icon>autorenew</mat-icon></button>
            </span>
          }
          @if (!data.user) {
            <mat-hint>{{ copied() ? 'Copié.' : 'À communiquer à l’utilisateur.' }}</mat-hint>
          }
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
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
    .password-actions {
      display: inline-flex;
    }
  `,
})
export class UserDialogComponent {
  protected readonly data = inject<UserDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<UserDialogComponent, ManagedUser>);
  private readonly api = inject(AdminApiService);
  protected readonly libraries = signal<Library[]>([]);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).group({
    username: [this.data.user?.username ?? '', Validators.required],
    role: [(this.data.user?.role ?? 'CAISSIER') as RoleCode, Validators.required],
    first_name: [this.data.user?.first_name ?? ''],
    last_name: [this.data.user?.last_name ?? ''],
    phone: [this.data.user?.phone ?? ''],
    email: [this.data.user?.email ?? '', Validators.email],
    password: [this.data.user ? '' : generatePassword(),
      this.data.user ? [] : [Validators.required, Validators.minLength(8)]],
    offline_max_hours: [this.data.user?.offline_max_hours ?? (null as number | null)],
    must_change_password: [this.data.user?.must_change_password ?? !this.data.user],
    library: [this.data.user?.library ?? (null as string | null)],
  });

  constructor() {
    inject(StockApiService).listLibraries().subscribe((libraries) => {
      this.libraries.set(libraries);
      // Une seule librairie : proposée d'office pour un nouvel employé.
      const active = libraries.filter((l) => l.is_active);
      if (!this.data.user && active.length === 1) {
        this.form.controls.library.setValue(active[0].id);
      }
    });
  }

  protected readonly copied = signal(false);

  protected newPassword(): void {
    this.form.controls.password.setValue(generatePassword());
    this.copied.set(false);
  }

  protected copyPassword(): void {
    navigator.clipboard?.writeText(this.form.controls.password.value ?? '').then(
      () => this.copied.set(true),
      () => undefined,
    );
  }

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
      library: raw.library ?? null,
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
