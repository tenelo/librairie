import { DatePipe, JsonPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { APP_CONFIG, AuthService, NetworkStatusService, Paginated } from '@librairie/shared';

interface SyncConflict {
  id: string;
  entity: string;
  entity_id: string;
  client_payload: unknown;
  server_payload: unknown;
  resolution_label: string;
  created_at: string;
  reviewed_at: string | null;
  device_code: string | null;
  username: string | null;
}

/** Conflits détectés par la règle « dernier écrit gagne », à examiner par un responsable. */
@Component({
  selector: 'bo-sync-conflicts-page',
  imports: [DatePipe, JsonPipe, MatButtonModule, MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Conflits de synchronisation</h1>
      <mat-slide-toggle [checked]="all()" (change)="all.set($event.checked); load()">Afficher les conflits examinés</mat-slide-toggle>
    </header>
    @if (!network.online()) {
      <p class="offline-note">La liste des conflits nécessite une connexion.</p>
    }
    @for (c of conflicts(); track c.id) {
      <article class="conflict">
        <header>
          <strong>{{ c.entity }}</strong> {{ c.entity_id }} · {{ c.created_at | date: 'dd/MM/yyyy HH:mm' }}
          · terminal {{ c.device_code ?? '—' }} · {{ c.username }} — <em>{{ c.resolution_label }}</em>
        </header>
        <div class="diff">
          <div><h4>Version du terminal</h4><pre>{{ c.client_payload | json }}</pre></div>
          <div><h4>Version du serveur</h4><pre>{{ c.server_payload | json }}</pre></div>
        </div>
        @if (!c.reviewed_at && canManage) {
          <button mat-stroked-button type="button" (click)="review(c)">Marquer comme examiné</button>
        }
      </article>
    } @empty {
      <p class="muted">Aucun conflit à examiner.</p>
    }
  `,
  styleUrl: '../catalog/catalog-page.scss',
  styles: `
    .conflict {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .diff {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    pre {
      white-space: pre-wrap;
      font-size: 12px;
    }
  `,
})
export class SyncConflictsPage {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/sync/conflicts/`;
  protected readonly network = inject(NetworkStatusService);
  protected readonly canManage = inject(AuthService).hasPermission('sync.manage');
  protected readonly conflicts = signal<SyncConflict[]>([]);
  protected readonly all = signal(false);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.http.get<Paginated<SyncConflict>>(this.api, { params: this.all() ? { all: 'true' } : {} })
      .subscribe({ next: (page) => this.conflicts.set(page.results), error: () => undefined });
  }

  protected review(conflict: SyncConflict): void {
    this.http.post(`${this.api}${conflict.id}/review/`, {}).subscribe(() => this.load());
  }
}
