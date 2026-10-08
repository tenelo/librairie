import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AuthService, NotificationPreferencesComponent } from '@librairie/shared';

@Component({
  selector: 'bt-account-page',
  imports: [RouterLink, MatCardModule, MatButtonModule, MatIconModule, NotificationPreferencesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mon compte</h1>
    @if (auth.user(); as user) {
      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-icon mat-card-avatar>account_circle</mat-icon>
          <mat-card-title>{{ user.full_name }}</mat-card-title>
          <mat-card-subtitle>{{ user.phone }}</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          @if (user.email) {
            <p>E-mail : {{ user.email }}</p>
          }
          <p><a mat-stroked-button routerLink="/mes-commandes"><mat-icon>receipt_long</mat-icon> Mes commandes et codes de retrait</a></p>
        </mat-card-content>
        <mat-card-actions>
          <button mat-button type="button" (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Se déconnecter
          </button>
        </mat-card-actions>
      </mat-card>
      <mat-card appearance="outlined" class="prefs">
        <mat-card-header><mat-card-title>Mes notifications</mat-card-title>
          <mat-card-subtitle>Soyez prévenu dès que votre commande est prête.</mat-card-subtitle></mat-card-header>
        <mat-card-content><lib-notification-preferences /></mat-card-content>
      </mat-card>
    }
  `,
  styles: `
    .prefs {
      margin-top: 16px;
    }
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
}
