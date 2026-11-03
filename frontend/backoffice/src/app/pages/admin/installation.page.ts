import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { PwaInstallService } from '../../services/pwa-install.service';

/** Administration › Installation : installer le backoffice sur ce poste comme un logiciel (PWA). */
@Component({
  selector: 'bo-installation-page',
  imports: [MatCardModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Installation</h1>

    <mat-card appearance="outlined" data-test="install-card">
      <mat-card-header><mat-card-title>Application sur ce poste</mat-card-title></mat-card-header>
      <mat-card-content class="install">
        <mat-icon class="install-icon">install_desktop</mat-icon>
        <div class="install-text">
          @if (pwa.installed()) {
            <strong>L'application est installée sur ce poste.</strong>
            <span>Elle s'ouvre depuis le menu Démarrer, le bureau ou l'écran d'accueil, et fonctionne aussi hors connexion.</span>
          } @else if (pwa.available()) {
            <strong>Installer l'application comme un logiciel.</strong>
            <span>Elle s'ouvrira dans sa propre fenêtre, depuis le menu Démarrer, le bureau ou l'écran d'accueil.</span>
          } @else {
            <strong>Installation non proposée par ce navigateur pour le moment.</strong>
            <span>Utilisez Chrome ou Edge, ou le menu du navigateur (⋮ › « Installer l'application » ou « Ajouter à l'écran d'accueil »).</span>
          }
        </div>
        @if (pwa.available() && !pwa.installed()) {
          <button mat-flat-button type="button" (click)="pwa.install()" data-test="install-app">
            <mat-icon>download</mat-icon>
            Installer l'application
          </button>
        }
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .install {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding-top: 12px;
    }
    .install-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      opacity: 0.8;
    }
    .install-text {
      flex: 1 1 260px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .install-text span {
      opacity: 0.75;
    }
  `,
})
export class InstallationPage {
  protected readonly pwa = inject(PwaInstallService);
}
