import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { apiErrorMessage } from '../format/api-error';
import { NotificationPreferenceRow, NotificationService } from './notification.service';

type Channel = 'in_app' | 'push' | 'email' | 'sms';

/** Préférences de notification par type d'événement et par canal, et activation du push sur l'appareil. */
@Component({
  selector: 'lib-notification-preferences',
  imports: [MatCheckboxModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="push">
      @if (notifications.pushEnabled()) {
        <span><mat-icon>notifications_active</mat-icon> Notifications push activées sur cet appareil.</span>
        <button mat-button type="button" (click)="disablePush()">Désactiver</button>
      } @else {
        <span><mat-icon>notifications_off</mat-icon> Recevez les alertes même application fermée.</span>
        <button mat-stroked-button type="button" (click)="enablePush()">Activer les notifications push</button>
      }
      <button mat-button type="button" (click)="test()">Envoyer une notification de test</button>
    </div>
    <table class="prefs">
      <thead><tr><th>Événement</th>@for (c of channels; track c.code) { <th>{{ c.label }}</th> }</tr></thead>
      <tbody>
        @for (row of rows(); track row.event) {
          <tr>
            <td>{{ row.label }}</td>
            @for (c of channels; track c.code) {
              <td><mat-checkbox [checked]="row[c.code]" (change)="toggle(row, c.code, $event.checked)"
                                [aria-label]="row.label + ' : ' + c.label" /></td>
            }
          </tr>
        }
      </tbody>
    </table>
    <div class="actions">
      <button mat-flat-button type="button" (click)="save()" [disabled]="saving() || !dirty()">Enregistrer</button>
    </div>
  `,
  styles: `
    .push { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 12px; }
    .push span { display: inline-flex; align-items: center; gap: 6px; }
    .prefs { width: 100%; border-collapse: collapse; }
    .prefs th, .prefs td { padding: 4px 8px; border-bottom: 1px solid var(--mat-sys-outline-variant); text-align: center; }
    .prefs th:first-child, .prefs td:first-child { text-align: left; }
    .actions { margin-top: 12px; text-align: right; }
  `,
})
export class NotificationPreferencesComponent implements OnInit {
  protected readonly notifications = inject(NotificationService);
  private readonly snack = inject(MatSnackBar);
  protected readonly rows = signal<NotificationPreferenceRow[]>([]);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly channels: { code: Channel; label: string }[] = [
    { code: 'in_app', label: 'Application' }, { code: 'push', label: 'Push' },
    { code: 'email', label: 'E-mail' }, { code: 'sms', label: 'SMS / WhatsApp' },
  ];

  async ngOnInit(): Promise<void> {
    try {
      this.rows.set(await this.notifications.preferences());
    } catch (err) {
      this.snack.open(apiErrorMessage(err), 'Fermer');
    }
  }

  protected toggle(row: NotificationPreferenceRow, channel: Channel, value: boolean): void {
    this.rows.update((rows) => rows.map((r) => (r.event === row.event ? { ...r, [channel]: value } : r)));
    this.dirty.set(true);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      this.rows.set(await this.notifications.savePreferences(this.rows()));
      this.dirty.set(false);
      this.snack.open('Préférences enregistrées.');
    } catch (err) {
      this.snack.open(apiErrorMessage(err), 'Fermer');
    } finally {
      this.saving.set(false);
    }
  }

  protected async enablePush(): Promise<void> {
    this.snack.open(await this.notifications.enablePush(), 'OK', { duration: 6000 });
  }

  protected async disablePush(): Promise<void> {
    await this.notifications.disablePush();
    this.snack.open('Notifications push désactivées sur cet appareil.');
  }

  protected async test(): Promise<void> {
    try {
      await this.notifications.sendTest();
    } catch (err) {
      this.snack.open(apiErrorMessage(err), 'Fermer');
    }
  }
}
