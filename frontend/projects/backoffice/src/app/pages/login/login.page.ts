import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, NetworkStatusService, OfflineAuthService, apiErrorMessage } from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

import { PinCaptureDialogComponent } from './pin-capture-dialog.component';

@Component({
  selector: 'bo-login-page',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bo-access">
      <mat-card class="card">
        @if (loading()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <div class="bo-signboard">
          <img src="logo.svg" alt="" />
          <div>
            <span class="bo-signboard-name">ETS MASSA</span>
            <span class="bo-signboard-tagline">Librairie générale · Photocopie</span>
          </div>
        </div>
        <mat-card-header>
          <mat-card-title>Espace du personnel</mat-card-title>
          <mat-card-subtitle>Connectez-vous pour accéder à la gestion</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          @if (!network.online()) {
            <p class="warning" role="alert">
              <mat-icon inline>cloud_off</mat-icon>
              Vous êtes hors ligne. La connexion par mot de passe nécessite le réseau.
            </p>
          }
          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field>
              <mat-label>Identifiant ou téléphone</mat-label>
              <input matInput formControlName="identifier" autocomplete="username" autofocus />
              @if (form.controls.identifier.hasError('required')) {
                <mat-error>L'identifiant est obligatoire.</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>Mot de passe</mat-label>
              <input
                matInput
                [type]="showPassword() ? 'text' : 'password'"
                formControlName="password"
                autocomplete="current-password"
              />
              <button
                mat-icon-button
                matSuffix
                type="button"
                (click)="showPassword.set(!showPassword())"
                [attr.aria-label]="showPassword() ? 'Masquer le mot de passe' : 'Afficher le mot de passe'"
              >
                <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (form.controls.password.hasError('required')) {
                <mat-error>Le mot de passe est obligatoire.</mat-error>
              }
            </mat-form-field>
            @if (error()) {
              <p class="error" role="alert">{{ error() }}</p>
            }
            <button mat-flat-button type="submit" [disabled]="loading() || !network.online()">
              Se connecter
            </button>
            @if (canUnlock()) {
              <a mat-button routerLink="/verrouillage"><mat-icon>pin</mat-icon> Reprendre avec mon code PIN</a>
            }
          </form>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .card {
      width: min(420px, 100%);
    }
    mat-card-header {
      padding-top: 16px;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 16px;
    }
    .error {
      color: var(--mat-sys-error);
      margin: 0 0 12px;
    }
    .warning {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly network = inject(NetworkStatusService);
  private readonly offlineAuth = inject(OfflineAuthService);
  private readonly dialog = inject(MatDialog);
  protected readonly canUnlock = signal(false);

  constructor() {
    void this.offlineAuth.unlockableUsers().then((users) => {
      this.canUnlock.set(users.length > 0);
      // Hors ligne avec des sessions mémorisées : on propose directement la reprise par PIN.
      if (users.length && !this.network.online() && !this.route.snapshot.queryParamMap.has('motdepasse')) {
        void this.router.navigateByUrl('/verrouillage');
      }
    });
  }

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    identifier: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const { identifier, password } = this.form.getRawValue();
    this.auth.login(identifier.trim(), password).subscribe({
      next: async (user) => {
        this.loading.set(false);
        await this.offlineAuth.remember(this.auth.session()!);
        if (user.has_pin && !(await this.offlineAuth.hasLocalPin(user.id))) {
          await firstValueFrom(this.dialog.open(PinCaptureDialogComponent, {
            data: { userId: user.id, username: user.username }, width: '420px', maxWidth: '95vw',
          }).afterClosed());
        }
        const target = this.route.snapshot.queryParamMap.get('retour');
        const destination = user.must_change_password ? '/mon-profil' : target || '/';
        void this.router.navigateByUrl(destination);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
