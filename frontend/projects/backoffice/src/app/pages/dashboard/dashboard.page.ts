import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { AuthService, DeviceService, NetworkStatusService, SyncStatusService } from '@librairie/shared';

import { MENU, visibleMenu } from '../../navigation/menu';

@Component({
  selector: 'bo-dashboard-page',
  imports: [MatCardModule, MatIconModule, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Bonjour {{ auth.user()?.first_name || auth.user()?.username }}</h1>
    <p class="subtitle">{{ auth.user()?.role?.label }} · {{ today | date: 'EEEE d MMMM y' }}</p>

    <section class="status">
      <mat-card appearance="outlined">
        <mat-card-content>
          <mat-icon [class.ok]="network.online()" [class.ko]="!network.online()">
            {{ network.online() ? 'wifi' : 'wifi_off' }}
          </mat-icon>
          <div>
            <strong>{{ network.online() ? 'En ligne' : 'Hors ligne' }}</strong>
            <small>Statut réseau</small>
          </div>
        </mat-card-content>
      </mat-card>
      <mat-card appearance="outlined">
        <mat-card-content>
          <mat-icon>pending_actions</mat-icon>
          <div>
            <strong>{{ sync.pendingCount() }}</strong>
            <small>Opérations en attente</small>
          </div>
        </mat-card-content>
      </mat-card>
      <mat-card appearance="outlined">
        <mat-card-content>
          <mat-icon>devices</mat-icon>
          <div>
            <strong>{{ device()?.code ?? 'Non enregistré' }}</strong>
            <small>Terminal</small>
          </div>
        </mat-card-content>
      </mat-card>
    </section>

    @if (!device()) {
      <p class="hint">
        <mat-icon inline>info</mat-icon>
        Ce poste n'est pas encore associé à un terminal. Un administrateur peut l'enregistrer depuis
        Administration › Terminaux ; ce code préfixera les reçus émis hors ligne.
      </p>
    }

    <h2>Accès rapide</h2>
    <section class="shortcuts">
      @for (section of sections(); track section.path) {
        <a class="shortcut" [routerLink]="['/', section.path]">
          <mat-icon>{{ section.icon }}</mat-icon>
          <span>{{ section.label }}</span>
        </a>
      }
    </section>
  `,
  styles: `
    h1 {
      margin: 0;
    }
    .subtitle {
      margin: 4px 0 24px;
      opacity: 0.75;
      text-transform: capitalize;
    }
    .status {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    mat-card-content {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    mat-card-content div {
      display: flex;
      flex-direction: column;
    }
    mat-card-content strong {
      font-size: 20px;
    }
    .ok {
      color: #2e7d32;
    }
    .ko {
      color: var(--mat-sys-error);
    }
    .hint {
      margin-top: 16px;
      padding: 12px 16px;
      border-radius: 8px;
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .shortcuts {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
    }
    .shortcut {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 20px 12px;
      border-radius: 12px;
      text-decoration: none;
      color: inherit;
      background: var(--mat-sys-surface-container);
      text-align: center;
    }
    .shortcut:hover {
      background: var(--mat-sys-surface-container-high);
    }
    .shortcut mat-icon {
      color: var(--mat-sys-primary);
    }
  `,
})
export class DashboardPage {
  protected readonly auth = inject(AuthService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly sync = inject(SyncStatusService);
  protected readonly device = inject(DeviceService).device;
  protected readonly today = new Date();

  protected readonly sections = computed(() =>
    visibleMenu(MENU, (permission) => this.auth.hasPermission(permission)).filter(
      (section) => section.children.length > 0,
    ),
  );
}
