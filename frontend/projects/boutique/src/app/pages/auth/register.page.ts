import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { AuthService, NetworkStatusService, apiErrorMessage } from '@librairie/shared';

@Component({
  selector: 'bt-register-page',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card appearance="outlined" class="auth-card">
      <mat-card-header><mat-card-title>Créer un compte</mat-card-title></mat-card-header>
      <mat-card-content>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field><mat-label>Prénom</mat-label><input matInput formControlName="first_name" /></mat-form-field>
          <mat-form-field><mat-label>Nom</mat-label><input matInput formControlName="last_name" /></mat-form-field>
          <mat-form-field>
            <mat-label>Numéro de téléphone</mat-label>
            <input matInput formControlName="phone" inputmode="tel" autocomplete="tel" placeholder="07 00 00 00 00" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>E-mail (facultatif)</mat-label><input matInput formControlName="email" type="email" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Mot de passe</mat-label>
            <input matInput type="password" formControlName="password" autocomplete="new-password" />
            <mat-hint>8 caractères minimum, pas uniquement des chiffres.</mat-hint>
          </mat-form-field>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <button mat-flat-button type="submit" [disabled]="form.invalid || loading() || !network.online()">
            Créer mon compte
          </button>
          <p>Déjà inscrit ? <a routerLink="/connexion">Se connecter</a></p>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styleUrl: './auth-page.scss',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly network = inject(NetworkStatusService);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    first_name: ['', Validators.required],
    last_name: ['', Validators.required],
    phone: ['', [Validators.required, Validators.pattern(/^\+?[0-9 ]{8,20}$/)]],
    email: ['', Validators.email],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  submit(): void {
    this.loading.set(true);
    this.error.set(null);
    this.auth.register(this.form.getRawValue()).subscribe({
      next: () => {
        this.loading.set(false);
        void this.router.navigateByUrl('/mon-compte');
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err));
      },
    });
  }
}
