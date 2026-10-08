import { Injectable, signal } from '@angular/core';

const DEVICE_KEY = 'librairie.device';

export interface LocalDevice {
  code: string;
  name: string;
}

/**
 * Terminal courant. Son code (attribué par l'administrateur) est envoyé dans l'en-tête
 * `X-Device-Code` et préfixera les numéros de reçus générés hors ligne.
 */
@Injectable({ providedIn: 'root' })
export class DeviceService {
  readonly device = signal<LocalDevice | null>(this.load());

  register(device: LocalDevice): void {
    const normalized = { code: device.code.trim().toUpperCase(), name: device.name };
    localStorage.setItem(DEVICE_KEY, JSON.stringify(normalized));
    this.device.set(normalized);
  }

  forget(): void {
    localStorage.removeItem(DEVICE_KEY);
    this.device.set(null);
  }

  private load(): LocalDevice | null {
    try {
      const raw = localStorage.getItem(DEVICE_KEY);
      return raw ? (JSON.parse(raw) as LocalDevice) : null;
    } catch {
      return null;
    }
  }
}
