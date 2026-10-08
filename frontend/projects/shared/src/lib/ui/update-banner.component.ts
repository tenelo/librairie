import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AppUpdateService } from '../pwa/app-update.service';

@Component({
  selector: 'lib-update-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updates.updateAvailable()) {
      <div class="update-banner" role="status">
        <span>Nouvelle version disponible.</span>
        <button type="button" (click)="updates.applyUpdate()">Recharger</button>
      </div>
    }
  `,
  styles: `
    .update-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 8px 16px;
      background: var(--mat-sys-tertiary-container, #ffe082);
      color: var(--mat-sys-on-tertiary-container, #3e2c00);
      font-weight: 500;
    }
    button {
      border: none;
      border-radius: 16px;
      padding: 6px 16px;
      cursor: pointer;
      background: var(--mat-sys-tertiary, #7a5900);
      color: var(--mat-sys-on-tertiary, #fff);
      font: inherit;
    }
  `,
})
export class UpdateBannerComponent {
  protected readonly updates = inject(AppUpdateService);
}
