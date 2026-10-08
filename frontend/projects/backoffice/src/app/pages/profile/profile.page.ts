import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService, NetworkStatusService, OfflineAuthService, apiErrorMessage } from '@librairie/shared';

import { AdminApiService } from '../../services/admin-api.service';

@Component({
  selector: 'bo-profile-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mon profil</h1>
    @if (auth.user(); as user) {
      <p>
        <strong>{{ user.full_name }}</strong> · {{ user.role?.label }} · identifiant <code>{{ user.username }}</code>
      </p>
      @if (user.must_change_password) {
        <p class="warning" role="alert">Vous devez définir un nouveau mot de passe.</p>
      }
    }

    <div class="grid">
      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>Changer de mot de passe</mat-card-title></mat-card-header>
        <mat-card-content>
          <form [formGroup]="passwordForm" (ngSubmit)="changePassword()">
            <mat-form-field>
              <mat-label>Mot de passe actuel</mat-label>
              <input matInput type="password" formControlName="current" autocomplete="current-password" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Nouveau mot de passe</mat-label>
              <input matInput type="password" formControlName="next" autocomplete="new-password" />
              <mat-hint>8 caractères minimum, pas uniquement des chiffres.</mat-hint>
            </mat-form-field>
            <button mat-flat-button type="submit" [disabled]="passwordForm.invalid || busy() || !network.online()">
              Enregistrer
            </button>
          </form>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>Code PIN</mat-card-title>
          <mat-card-subtitle>
            {{ auth.user()?.has_pin ? 'Un PIN est défini.' : 'Aucun PIN défini.' }}
          </mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <p class="help">
            Le PIN (4 à 6 chiffres) sert à reprendre la main sur un terminal hors ligne et à valider les
            autorisations (remises, retours).
          </p>
          <form [formGroup]="pinForm" (ngSubmit)="setPin()">
            <mat-form-field>
              <mat-label>Mot de passe</mat-label>
              <input matInput type="password" formControlName="password" autocomplete="current-password" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Nouveau PIN</mat-label>
              <input matInput type="password" inputmode="numeric" maxlength="6" formControlName="pin" />
              @if (pinForm.controls.pin.hasError('pattern')) {
                <mat-error>4 à 6 chiffres.</mat-error>
              }
            </mat-form-field>
            <button mat-flat-button type="submit" [disabled]="pinForm.invalid || busy() || !network.online()">
              Définir le PIN
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 12px;
    }
    .help {
      opacity: 0.8;
    }
    .warning {
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  protected readonly network = inject(NetworkStatusService);
  private readonly api = inject(AdminApiService);
  private readonly offlineAuth = inject(OfflineAuthService);
  private readonly snack = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly busy = signal(false);
  protected readonly passwordForm = this.fb.group({
    current: ['', Validators.required],
    next: ['', [Validators.required, Validators.minLength(8)]],
  });
  protected readonly pinForm = this.fb.group({
    password: ['', Validators.required],
    pin: ['', [Validators.required, Validators.pattern(/^[0-9]{4,6}$/)]],
  });

  changePassword(): void {
    const { current, next } = this.passwordForm.getRawValue();
    this.busy.set(true);
    this.api.changePassword(current, next).subscribe({
      next: () => {
        this.passwordForm.reset();
        this.refreshProfile('Mot de passe modifié.');
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  setPin(): void {
    const { password, pin } = this.pinForm.getRawValue();
    this.busy.set(true);
    this.api.setPin(password, pin).subscribe({
      next: () => {
        this.pinForm.reset();
        this.refreshProfile('Code PIN enregistré (utilisable hors connexion sur ce terminal).', pin);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private refreshProfile(message: string, localPin?: string): void {
    this.auth.reloadProfile().subscribe({
      next: async (user) => {
        if (localPin) {
          await this.offlineAuth.remember(this.auth.session()!);
          await this.offlineAuth.setLocalPin(user.id, localPin);
        }
        this.busy.set(false);
        this.snack.open(message);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
  }
}
