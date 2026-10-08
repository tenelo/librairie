import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { APP_CONFIG, NotificationPreferencesComponent } from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

interface EventInfo {
  event: string;
  label: string;
  audience: 'staff' | 'customer';
  permission: string | null;
  defaults: string[];
}

const CHANNEL_LABELS: Record<string, string> = { in_app: 'application', push: 'push', email: 'e-mail', sms: 'SMS' };

/** Administration des notifications : événements, destinataires, canaux par défaut, état du push. */
@Component({
  selector: 'bo-notifications-admin-page',
  imports: [MatCardModule, MatIconModule, NotificationPreferencesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Notifications</h1>
    <p>
      @if (vapid()) { <mat-icon inline>check_circle</mat-icon> Web Push configuré (clés VAPID présentes). }
      @else { <mat-icon inline>warning</mat-icon> Web Push inactif : renseignez VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY (voir README). }
    </p>
    <mat-card appearance="outlined">
      <mat-card-header><mat-card-title>Événements notifiés</mat-card-title>
        <mat-card-subtitle>Chaque utilisateur peut ajuster les canaux dans son profil.</mat-card-subtitle></mat-card-header>
      <mat-card-content>
        <table class="list">
          <thead><tr><th>Événement</th><th>Destinataires</th><th>Canaux par défaut</th></tr></thead>
          <tbody>
            @for (e of events(); track e.event) {
              <tr><td>{{ e.label }}</td>
                <td>{{ e.audience === 'customer' ? 'Client concerné' : 'Personnel avec « ' + e.permission + ' »' }}</td>
                <td>{{ channels(e.defaults) }}</td></tr>
            }
          </tbody>
        </table>
      </mat-card-content>
    </mat-card>
    <mat-card appearance="outlined" class="mine">
      <mat-card-header><mat-card-title>Mes préférences</mat-card-title></mat-card-header>
      <mat-card-content><lib-notification-preferences /></mat-card-content>
    </mat-card>
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `.mine { margin-top: 16px; }`,
})
export class NotificationsAdminPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/notifications`;
  protected readonly events = signal<EventInfo[]>([]);
  protected readonly vapid = signal(false);

  async ngOnInit(): Promise<void> {
    this.events.set(await firstValueFrom(this.http.get<EventInfo[]>(`${this.api}/events/`)));
    const push = await firstValueFrom(this.http.get<{ public_key: string | null }>(`${this.api}/push/`));
    this.vapid.set(!!push.public_key);
  }

  protected channels(codes: string[]): string {
    return codes.map((c) => CHANNEL_LABELS[c] ?? c).join(', ');
  }
}
