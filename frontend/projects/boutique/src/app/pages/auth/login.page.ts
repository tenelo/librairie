import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, NetworkStatusService, apiErrorMessage } from '@librairie/shared';

@Component({
  selector: 'bt-login-page',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card appearance="outlined" class="auth-card">
      <mat-card-header><mat-card-title>Se connecter</mat-card-title></mat-card-header>
      <mat-card-content>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field>
            <mat-label>Numéro de téléphone</mat-label>
            <input matInput formControlName="phone" inputmode="tel" autocomplete="tel" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Mot de passe</mat-label>
            <input matInput type="password" formControlName="password" autocomplete="current-password" />
          </mat-form-field>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <button mat-flat-button type="submit" [disabled]="form.invalid || loading() || !network.online()">
            Se connecter
          </button>
          <p>Pas encore de compte ? <a routerLink="/inscription">Créer un compte</a></p>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styleUrl: './auth-page.scss',
})
export class ShopLoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly network = inject(NetworkStatusService);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    phone: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    const { phone, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(phone.trim(), password).subscribe({
      next: () => {
        this.loading.set(false);
        void this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('retour') || '/mon-compte');
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
