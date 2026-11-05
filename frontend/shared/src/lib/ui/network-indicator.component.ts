import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { NetworkStatusService } from '../network/network-status.service';
import { SyncStatusService } from '../sync/sync-status.service';

/** Indicateurs permanents : réseau, opérations en attente, dernière synchronisation. */
@Component({
  selector: 'lib-network-indicator',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pill" [class.offline]="!network.online()" role="status" aria-live="polite"
          [title]="network.online() ? 'En ligne' : 'Hors ligne'">
      <span class="dot"></span>
      <span class="lbl">{{ network.online() ? 'En ligne' : 'Hors ligne' }}</span>
    </span>
    @if (showSync()) {
      <span class="pill" [class.pending]="sync.hasPending()" title="Opérations en attente de synchronisation">
        {{ sync.pendingCount() }}<span class="lbl">&nbsp;en attente</span>
      </span>
      <span class="last-sync" title="Dernière synchronisation">
        @if (sync.lastSyncAt(); as last) {
          Synchro : {{ last | date: 'dd/MM HH:mm' }}
        } @else {
          Jamais synchronisé
        }
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      flex-wrap: nowrap;
    }
    /* Téléphone : pastilles réduites (point de couleur, nombre en attente) pour tenir sur une ligne. */
    @media (max-width: 599px) {
      .lbl {
        display: none;
      }
      .pill {
        padding: 2px 8px;
      }
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 12px;
      background: rgba(46, 125, 50, 0.18);
      white-space: nowrap;
    }
    .pill.offline {
      background: rgba(198, 40, 40, 0.25);
    }
    .pill.pending {
      background: rgba(239, 108, 0, 0.25);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #43a047;
    }
    .offline .dot {
      background: #e53935;
    }
    .last-sync {
      opacity: 0.85;
      white-space: nowrap;
    }
  `,
})
export class NetworkIndicatorComponent {
  protected readonly network = inject(NetworkStatusService);
  protected readonly sync = inject(SyncStatusService);
  readonly showSync = input(true);
}
