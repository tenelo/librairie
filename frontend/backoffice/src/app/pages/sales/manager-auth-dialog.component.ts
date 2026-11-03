import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  APP_CONFIG,
  LocalDbService,
  NetworkStatusService,
  NotificationService,
  OfflineUser,
  hashPin,
} from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

export interface ManagerAuthData {
  title: string;
  reason: string;
  permission: string;
  /** Remise demandée (%), comparée au plafond du rôle du responsable. */
  percent?: number;
}

/**
 * Autorisation d'un responsable par mot de passe (remise au-delà du plafond, retour).
 * En ligne : vérification par le serveur ; hors ligne : empreinte du mot de passe (enregistrée à sa dernière
 * connexion sur ce terminal) et permissions mémorisées.
 * Renvoie l'identifiant du responsable, transmis au serveur qui revérifie ses droits.
 */
@Component({
  selector: 'bo-manager-auth-dialog',
  imports: [FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form (ngSubmit)="submit()">
      <mat-dialog-content class="fields">
        <p>{{ data.reason }}</p>
        @if (network.online()) {
          <mat-form-field><mat-label>Identifiant du responsable</mat-label>
            <input matInput name="username" [(ngModel)]="username" autocomplete="off" /></mat-form-field>
        } @else {
          <mat-form-field>
            <mat-label>Responsable</mat-label>
            <mat-select name="username" [(ngModel)]="username">
              @for (m of managers(); track m.id) { <mat-option [value]="m.username">{{ m.fullName }}</mat-option> }
            </mat-select>
            @if (!managers().length) {
              <mat-hint>Aucun responsable ne s'est encore connecté sur ce terminal.</mat-hint>
            }
          </mat-form-field>
        }
        <mat-form-field><mat-label>Mot de passe du responsable</mat-label>
          <input matInput type="password" name="password" [(ngModel)]="password" autocomplete="off" /></mat-form-field>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Annuler</button>
        @if (network.online()) {
          <button mat-button type="button" (click)="callManager()" [disabled]="called()">
            {{ called() ? 'Responsable prévenu' : 'Appeler un responsable' }}
          </button>
        }
        <button mat-flat-button type="submit" [disabled]="!username || !password || busy()">Autoriser</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .fields { display: flex; flex-direction: column; }
    .error { color: var(--mat-sys-error); }
  `,
})
export class ManagerAuthDialogComponent {
  protected readonly data = inject<ManagerAuthData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ManagerAuthDialogComponent, string>);
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly local = inject(LocalDbService);
  protected readonly network = inject(NetworkStatusService);
  private readonly notifications = inject(NotificationService);
  protected readonly called = signal(false);
  protected readonly managers = signal<OfflineUser[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Identifiant du responsable reconnu (il peut avoir saisi son téléphone). */
  private authorizer: string | null = null;
  protected username = '';
  protected password = '';

  constructor() {
    void this.local.db.users.toArray().then((users) => this.managers.set(users.filter((u) =>
      u.pinHash && this.allowed(u))));
  }

  private allowed(user: OfflineUser): boolean {
    const profile = user.session.user;
    const hasPermission = profile.is_superuser || profile.permissions.includes(this.data.permission);
    const cap = profile.is_superuser ? 100 : profile.role?.max_discount_percent ?? 0;
    return hasPermission && (this.data.percent === undefined || cap >= this.data.percent);
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const ok = this.network.online() ? await this.verifyOnline() : await this.verifyOffline();
      if (ok) {
        this.ref.close(this.authorizer ?? this.username.trim());
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async verifyOnline(): Promise<boolean> {
    try {
      const result = await firstValueFrom(this.http.post<{ valid: boolean; has_permission: boolean;
        user: { username: string; role: { max_discount_percent: number } | null; is_superuser: boolean } | null }>(
        `${this.api}/auth/password/verify/`, { username: this.username.trim(), password: this.password,
          permission: this.data.permission }));
      const cap = result.user?.is_superuser ? 100 : result.user?.role?.max_discount_percent ?? 0;
      if (!result.valid) {
        this.error.set('Identifiant ou mot de passe incorrect.');
      } else if (!result.has_permission || (this.data.percent !== undefined && cap < this.data.percent)) {
        this.error.set('Ce responsable ne peut pas accorder cette autorisation.');
      } else {
        this.authorizer = result.user?.username ?? null;
        return true;
      }
    } catch {
      return this.verifyOffline();
    }
    return false;
  }

  private async verifyOffline(): Promise<boolean> {
    const user = await this.local.db.users.where('username').equals(this.username.trim()).first();
    if (!user?.pinHash || !user.pinSalt) {
      this.error.set('Ce responsable ne s\'est jamais connecté sur ce terminal : autorisation impossible hors ligne.');
      return false;
    }
    if ((await hashPin(this.password, user.pinSalt)).hash !== user.pinHash) {
      this.error.set('Mot de passe incorrect.');
      return false;
    }
    if (!this.allowed(user)) {
      this.error.set('Ce responsable ne peut pas accorder cette autorisation.');
      return false;
    }
    return true;
  }

  /** Notifie les responsables (cloche, push) qu'une autorisation est attendue à ce poste. */
  protected async callManager(): Promise<void> {
    try {
      const result = await this.notifications.requestAuthorization(`${this.data.title} — ${this.data.reason}`);
      this.called.set(true);
      this.error.set(result.notified ? null : 'Aucun responsable joignable : demandez-lui de venir au poste.');
    } catch {
      this.error.set('Impossible de prévenir un responsable pour le moment.');
    }
  }
}
