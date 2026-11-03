import { Injectable, signal } from '@angular/core';

/** Événement « beforeinstallprompt » (Chrome, Edge, Android) : non typé dans lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Installation de la PWA sur le poste (comme un logiciel).
 * Le navigateur n'émet « beforeinstallprompt » qu'une fois, au chargement : l'écoute est donc
 * démarrée dès le lancement de l'application (app.config.ts), et le bouton se trouve dans
 * Administration › Paramètres librairie et reçus.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  /** Le navigateur propose l'installation (bouton actif). */
  readonly available = signal(false);

  /** L'application tourne déjà en mode installé (fenêtre autonome). */
  readonly installed = signal(
    typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true),
  );

  listen(): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.available.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.available.set(false);
      this.installed.set(true);
    });
  }

  async install(): Promise<void> {
    if (!this.deferredPrompt) {
      return;
    }
    await this.deferredPrompt.prompt();
    await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.available.set(false);
  }
}
