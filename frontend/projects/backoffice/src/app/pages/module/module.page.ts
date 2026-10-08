import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { NetworkStatusService } from '@librairie/shared';

const PHASES: Record<number, string> = {
  2: 'Catalogue et kits',
  3: 'Stock et achats',
  4: 'Couche hors connexion',
  5: 'Ventes et caisse',
  6: 'Inventaires',
  7: 'Boutique et commandes en ligne',
  8: 'Notifications',
  9: 'Statistiques et exports',
};

/**
 * Page d'un module dont les écrans sont livrés dans une phase ultérieure du projet.
 * Le menu, la route et le contrôle des permissions sont déjà en place.
 */
@Component({
  selector: 'bo-module-page',
  imports: [MatCardModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="breadcrumb">{{ section() }}</p>
    <h1>{{ title() }}</h1>
    @if (requiresOnline() && !network.online()) {
      <p class="offline" role="alert">
        <mat-icon inline>cloud_off</mat-icon>
        Cette fonction nécessite une connexion au serveur.
      </p>
    }
    <mat-card appearance="outlined">
      <mat-card-content class="content">
        <mat-icon class="icon">construction</mat-icon>
        <div>
          @if (description()) {
            <p>{{ description() }}</p>
          }
          @if (phase(); as p) {
            <p>
              Ce module est livré à la <strong>phase {{ p }}</strong> ({{ phaseLabel(p) }}) du projet.
            </p>
          }
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .breadcrumb {
      margin: 0;
      opacity: 0.7;
    }
    h1 {
      margin-top: 4px;
    }
    .content {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: var(--mat-sys-primary);
    }
    .offline {
      display: flex;
      gap: 8px;
      align-items: center;
      color: var(--mat-sys-error);
    }
  `,
})
export class ModulePage {
  protected readonly network = inject(NetworkStatusService);

  readonly title = input('');
  readonly section = input('');
  readonly phase = input<number | undefined>(undefined);
  readonly description = input<string | undefined>(undefined);
  readonly requiresOnline = input(false);

  protected phaseLabel(phase: number): string {
    return PHASES[phase] ?? '';
  }
}
