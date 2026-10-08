import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '@librairie/shared';

@Component({
  selector: 'bt-account-page',
  imports: [MatCardModule, MatButtonModule, MatIconModule],
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
          <p>Le suivi de vos commandes et vos codes de retrait apparaîtront ici.</p>
        </mat-card-content>
        <mat-card-actions>
          <button mat-button type="button" (click)="auth.logout()">
            <mat-icon>logout</mat-icon> Se déconnecter
          </button>
        </mat-card-actions>
      </mat-card>
    }
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
}
