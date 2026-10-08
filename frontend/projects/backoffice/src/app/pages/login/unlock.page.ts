import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { Router, RouterLink } from '@angular/router';
import { AuditLocalService } from '../../services/audit-local.service';
import { NetworkStatusService, OfflineAuthService, OfflineUser } from '@librairie/shared';

/**
 * Reprise de session par PIN : hors connexion (après une première connexion en ligne) ou pour
 * qu'un autre caissier prenne le relais sur le même terminal.
 */
@Component({
  selector: 'bo-unlock-page',
  imports: [FormsModule, RouterLink, MatCardModule, MatListModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="unlock">
      <mat-card class="card">
        <mat-card-header>
          <mat-icon mat-card-avatar class="logo">lock</mat-icon>
          <mat-card-title>Reprendre la main</mat-card-title>
          <mat-card-subtitle>{{ network.online() ? 'En ligne' : 'Hors ligne' }} · code PIN</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          @if (!selected()) {
            <mat-nav-list>
              @for (user of users(); track user.id) {
                <button mat-list-item type="button" (click)="choose(user)">
                  <mat-icon matListItemIcon>account_circle</mat-icon>
                  <span matListItemTitle>{{ user.fullName }}</span>
                  <span matListItemLine>{{ user.roleLabel }}</span>
                </button>
              } @empty {
                <p class="muted">Aucun utilisateur ne peut reprendre la main sur ce terminal : une première connexion
                  en ligne avec un PIN défini est nécessaire (ou la durée maximale hors ligne est dépassée).</p>
              }
            </mat-nav-list>
          } @else {
            <p><strong>{{ selected()?.fullName }}</strong></p>
            <form (ngSubmit)="unlock()">
              <mat-form-field>
                <mat-label>Code PIN</mat-label>
                <input matInput type="password" inputmode="numeric" maxlength="6" name="pin" [(ngModel)]="pin"
                       autocomplete="off" autofocus />
              </mat-form-field>
              @if (error()) {
                <p class="error" role="alert">{{ error() }}</p>
              }
              <div class="actions">
                <button mat-button type="button" (click)="selected.set(null)">Retour</button>
                <button mat-flat-button type="submit" [disabled]="pin.length < 4 || busy()">Déverrouiller</button>
              </div>
            </form>
          }
          <p><a routerLink="/connexion" [queryParams]="{ motdepasse: 1 }">Se connecter avec un mot de passe</a></p>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .unlock {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 16px;
      background: var(--mat-sys-surface-container-low);
    }
    .card {
      width: min(440px, 100%);
    }
    .logo {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: var(--mat-sys-primary);
    }
    form {
      display: flex;
      flex-direction: column;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .muted {
      opacity: 0.75;
    }
  `,
})
export class UnlockPage {
  private readonly offlineAuth = inject(OfflineAuthService);
  private readonly router = inject(Router);
  private readonly audit = inject(AuditLocalService);
  protected readonly network = inject(NetworkStatusService);

  protected readonly users = signal<OfflineUser[]>([]);
  protected readonly selected = signal<OfflineUser | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected pin = '';
  private failures = 0;

  constructor() {
    void this.offlineAuth.unlockableUsers().then((users) => this.users.set(users));
  }

  protected choose(user: OfflineUser): void {
    this.selected.set(user);
    this.pin = '';
    this.error.set(null);
  }

  protected async unlock(): Promise<void> {
    const user = this.selected();
    if (!user) {
      return;
    }
    this.busy.set(true);
    const ok = await this.offlineAuth.unlock(user.id, this.pin);
    this.busy.set(false);
    await this.audit.record(ok ? 'PIN_UNLOCK' : 'PIN_FAILED', user.username);
    if (ok) {
      void this.router.navigateByUrl('/');
      return;
    }
    this.failures++;
    this.pin = '';
    this.error.set(this.failures >= 5 ? 'Trop d’échecs : connectez-vous avec votre mot de passe.' : 'Code PIN incorrect.');
    if (this.failures >= 5) {
      this.selected.set(null);
    }
  }
}
