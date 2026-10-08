import { Injectable, inject } from '@angular/core';
import { OutboxService } from '@librairie/shared';

export type LocalAuditAction = 'PIN_UNLOCK' | 'PIN_FAILED' | 'REPRINT' | 'DRAWER_OPEN' | 'DISCOUNT_OVERRIDE';

/**
 * Événements d'audit survenus sur le terminal (y compris hors ligne) : mis en outbox puis inscrits
 * au journal du serveur avec la date client à la synchronisation.
 */
@Injectable({ providedIn: 'root' })
export class AuditLocalService {
  private readonly outbox = inject(OutboxService);

  async record(action: LocalAuditAction, username: string, details: { entity?: string; entity_id?: string;
    description?: string } = {}): Promise<void> {
    await this.outbox.enqueue('audit_event', 'create', { action, username, ...details }, {
      label: `Audit : ${action} (${username})`,
    });
  }
}
