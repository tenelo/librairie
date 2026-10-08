import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { APP_CONFIG, PublicLibrarySettings } from '@librairie/shared';

const CACHE_KEY = 'librairie.boutique.info';

/** Informations publiques de la librairie, mises en cache localement pour l'affichage hors ligne. */
@Injectable({ providedIn: 'root' })
export class ShopInfoService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;

  readonly info = signal<PublicLibrarySettings | null>(this.cached());

  load(): void {
    this.http.get<PublicLibrarySettings>(`${this.api}/settings/public/`).subscribe({
      next: (info) => {
        localStorage.setItem(CACHE_KEY, JSON.stringify(info));
        this.info.set(info);
      },
      error: () => undefined,
    });
  }

  private cached(): PublicLibrarySettings | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as PublicLibrarySettings) : null;
    } catch {
      return null;
    }
  }
}
