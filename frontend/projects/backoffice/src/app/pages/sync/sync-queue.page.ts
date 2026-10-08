import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OutboxEntry, OutboxService, SyncEngineService } from '@librairie/shared';

/** File de synchronisation du terminal : opérations en attente, en nouvel essai ou refusées. */
@Component({
  selector: 'bo-sync-queue-page',
  imports: [DatePipe, JsonPipe, MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>File de synchronisation</h1>
      <button mat-stroked-button type="button" (click)="reload()"><mat-icon>refresh</mat-icon> Actualiser</button>
    </header>
    <table class="queue">
      <thead><tr><th>Date</th><th>Opération</th><th>Statut</th><th>Tentatives</th><th></th></tr></thead>
      <tbody>
        @for (entry of entries(); track entry.id) {
          <tr [class.error]="entry.status === 'error'">
            <td>{{ entry.createdAt | date: 'dd/MM HH:mm:ss' }}</td>
            <td>{{ entry.label }}</td>
            <td>
              {{ statusLabel(entry) }}
              @if (entry.error) { <br /><small>{{ entry.error }}</small> }
              @if (entry.status === 'retry') { <br /><small>prochain essai {{ entry.nextAttemptAt | date: 'HH:mm:ss' }}</small> }
            </td>
            <td>{{ entry.attempts }}</td>
            <td class="actions">
              <button mat-icon-button type="button" matTooltip="Détail" (click)="toggle(entry.id)"><mat-icon>info</mat-icon></button>
              @if (entry.status === 'error') {
                <button mat-icon-button type="button" matTooltip="Relancer" (click)="retry(entry)"><mat-icon>replay</mat-icon></button>
                <button mat-icon-button type="button" matTooltip="Abandonner" (click)="discard(entry)"><mat-icon>delete</mat-icon></button>
              }
            </td>
          </tr>
          @if (open() === entry.id) {
            <tr><td colspan="5"><pre>{{ entry.payload | json }}</pre></td></tr>
          }
        } @empty {
          <tr><td colspan="5" class="empty">Aucune opération en attente : tout est synchronisé.</td></tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: '../catalog/catalog-page.scss',
  styles: `
    .queue {
      width: 100%;
      border-collapse: collapse;
    }
    .queue th,
    .queue td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
    }
    tr.error {
      background: color-mix(in srgb, var(--mat-sys-error) 8%, transparent);
    }
    pre {
      white-space: pre-wrap;
      font-size: 12px;
    }
  `,
})
export class SyncQueuePage {
  private readonly outbox = inject(OutboxService);
  private readonly engine = inject(SyncEngineService);
  protected readonly entries = signal<OutboxEntry[]>([]);
  protected readonly open = signal<string | null>(null);

  constructor() {
    void this.reload();
  }

  protected statusLabel(entry: OutboxEntry): string {
    return { pending: 'En attente', retry: 'Nouvel essai programmé', error: 'Refusée' }[entry.status];
  }

  protected toggle(id: string): void {
    this.open.set(this.open() === id ? null : id);
  }

  protected async retry(entry: OutboxEntry): Promise<void> {
    await this.outbox.retry(entry.id);
    await this.engine.syncNow();
    await this.reload();
  }

  protected async discard(entry: OutboxEntry): Promise<void> {
    if (confirm(`Abandonner définitivement « ${entry.label} » ? L'opération ne sera jamais envoyée au serveur.`)) {
      await this.outbox.discard(entry.id);
      await this.engine.refreshCounts();
      await this.reload();
    }
  }

  protected async reload(): Promise<void> {
    this.entries.set(await this.outbox.all());
  }
}
