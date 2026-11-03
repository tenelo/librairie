import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  AuthService,
  NetworkStatusService,
  NotificationPreferencesComponent,
  OfflineAuthService,
  apiErrorMessage,
} from '@librairie/shared';

import { ONLINE_SALES_ENABLED } from '../../features';
import { AdminApiService } from '../../services/admin-api.service';

@Component({
  selector: 'bo-profile-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule,
    NotificationPreferencesComponent],
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
        <mat-card-header><mat-card-title>Mon nom</mat-card-title></mat-card-header>
        <mat-card-content>
          <form [formGroup]="nameForm" (ngSubmit)="saveName()">
            <mat-form-field>
              <mat-label>Prénom(s)</mat-label>
              <input matInput formControlName="firstName" autocomplete="given-name" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Nom</mat-label>
              <input matInput formControlName="lastName" autocomplete="family-name" />
            </mat-form-field>
            <button mat-flat-button type="submit"
                    [disabled]="nameForm.invalid || nameForm.pristine || busy() || !network.online()">Enregistrer</button>
          </form>
        </mat-card-content>
      </mat-card>

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
          <p class="help">
            Ce mot de passe sert aussi à reprendre la main sur ce terminal (changer d'utilisateur, hors ligne) et,
            pour un responsable, à autoriser une remise ou un retour à la caisse.
          </p>
        </mat-card-content>
      </mat-card>
    </div>
    <mat-card appearance="outlined" class="notifications">
      <mat-card-header><mat-card-title>Mes notifications</mat-card-title></mat-card-header>
      <mat-card-content><lib-notification-preferences [hiddenEvent]="hiddenEvent" /></mat-card-content>
    </mat-card>
  `,
  styles: `
    .notifications {
      margin-top: 16px;
    }
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
  /** Vente en ligne désactivée (features.ts) : ses notifications (commandes) ne sont pas proposées. */
  protected readonly hiddenEvent = (event: string) => !ONLINE_SALES_ENABLED && event.startsWith('order_');
  protected readonly passwordForm = this.fb.group({
    current: ['', Validators.required],
    next: ['', [Validators.required, Validators.minLength(8)]],
  });
  protected readonly nameForm = this.fb.group({
    firstName: [this.auth.user()?.first_name ?? '', [Validators.required, Validators.maxLength(150)]],
    lastName: [this.auth.user()?.last_name ?? '', Validators.maxLength(150)],
  });

  saveName(): void {
    const { firstName, lastName } = this.nameForm.getRawValue();
    this.busy.set(true);
    this.api.updateMyName(firstName.trim(), lastName.trim()).subscribe({
      next: () => {
        this.nameForm.markAsPristine();
        this.refreshProfile('Nom modifié.');
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  changePassword(): void {
    const { current, next } = this.passwordForm.getRawValue();
    this.busy.set(true);
    this.api.changePassword(current, next).subscribe({
      next: () => {
        this.passwordForm.reset();
        // Le nouveau mot de passe sert aussi à reprendre la main sur ce terminal.
        this.refreshProfile('Mot de passe modifié.', next);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private refreshProfile(message: string, newPassword?: string): void {
    this.auth.reloadProfile().subscribe({
      next: async (user) => {
        await this.offlineAuth.remember(this.auth.session()!);
        if (newPassword) {
          await this.offlineAuth.setLocalPassword(user.id, newPassword);
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
