import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom, take } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { APP_CONFIG } from '../config/app-config';
import { Paginated } from '../models/auth.models';
import { NetworkStatusService } from '../network/network-status.service';

export interface AppNotification {
  id: string;
  event: string;
  title: string;
  body: string;
  url: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreferenceRow {
  event: string;
  label: string;
  in_app: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
}

/** Délai avant la n-ième reconnexion WebSocket (1 s, 2 s, 4 s… plafonné à 60 s). */
export function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(attempt, 0), 60000);
}

/** Convertit la clé publique VAPID (base64 url) pour `PushManager.subscribe`. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/**
 * Notifications de l'utilisateur : liste et compteur (API), temps réel par WebSocket
 * (`/ws/status/`, reconnexion automatique), abonnement Web Push via le service worker.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly network = inject(NetworkStatusService);
  private readonly config = inject(APP_CONFIG);
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly api = `${this.config.apiBaseUrl}/notifications`;

  readonly items = signal<AppNotification[]>([]);
  readonly unread = signal(0);
  readonly connected = signal(false);
  /** Dernière notification reçue en temps réel (affichée brièvement par l'application). */
  readonly incoming = signal<AppNotification | null>(null);
  readonly pushSupported = signal(!!this.swPush?.isEnabled);
  readonly pushEnabled = signal(false);

  private socket: WebSocket | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    effect(() => {
      const online = this.network.online();
      const authenticated = this.auth.isAuthenticated();
      if (!this.started) {
        return;
      }
      if (online && authenticated) {
        this.connect();
        void this.refresh();
      } else {
        this.disconnect();
      }
    });
    this.swPush?.subscription.subscribe((sub) => this.pushEnabled.set(!!sub));
  }

  /** Démarre le temps réel (appelé par le gabarit de l'application une fois l'utilisateur connecté). */
  start(): void {
    this.started = true;
    if (this.network.online() && this.auth.isAuthenticated()) {
      this.connect();
      void this.refresh();
    }
  }

  stop(): void {
    this.started = false;
    this.disconnect();
    this.items.set([]);
    this.unread.set(0);
  }

  async refresh(): Promise<void> {
    try {
      const page = await firstValueFrom(this.http.get<Paginated<AppNotification>>(`${this.api}/`,
        { params: { page_size: 30 } }));
      this.items.set(page.results);
      const count = await firstValueFrom(this.http.get<{ unread: number }>(`${this.api}/unread/`));
      this.unread.set(count.unread);
    } catch {
      // Hors ligne ou session expirée : la liste précédente reste affichée.
    }
  }

  async markRead(notification: AppNotification): Promise<void> {
    if (notification.read_at) {
      return;
    }
    const updated = await firstValueFrom(this.http.post<AppNotification>(`${this.api}/${notification.id}/read/`, {}));
    this.items.update((list) => list.map((n) => (n.id === updated.id ? updated : n)));
    this.unread.update((n) => Math.max(n - 1, 0));
  }

  async markAllRead(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.api}/read-all/`, {}));
    const now = new Date().toISOString();
    this.items.update((list) => list.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    this.unread.set(0);
  }

  preferences(): Promise<NotificationPreferenceRow[]> {
    return firstValueFrom(this.http.get<NotificationPreferenceRow[]>(`${this.api}/preferences/`));
  }

  savePreferences(rows: NotificationPreferenceRow[]): Promise<NotificationPreferenceRow[]> {
    return firstValueFrom(this.http.put<NotificationPreferenceRow[]>(`${this.api}/preferences/`, rows));
  }

  sendTest(): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.api}/test/`, {}));
  }

  requestAuthorization(reason: string): Promise<{ notified: number }> {
    return firstValueFrom(this.http.post<{ notified: number }>(`${this.api}/authorization-request/`, { reason }));
  }

  /** Active les notifications push sur ce navigateur (consentement demandé par le navigateur). */
  async enablePush(): Promise<string> {
    if (!this.swPush?.isEnabled) {
      return 'Notifications push indisponibles : application non installée ou navigateur non compatible (HTTPS requis).';
    }
    const { public_key: publicKey } = await firstValueFrom(
      this.http.get<{ public_key: string | null }>(`${this.api}/push/`));
    if (!publicKey) {
      return 'Notifications push non configurées sur le serveur (clés VAPID).';
    }
    try {
      const subscription = await this.swPush.requestSubscription({ serverPublicKey: publicKey });
      const json = subscription.toJSON();
      await firstValueFrom(this.http.post(`${this.api}/push/`, { endpoint: json.endpoint, keys: json.keys,
        app: this.config.app }));
      this.pushEnabled.set(true);
      return 'Notifications push activées sur cet appareil.';
    } catch {
      return 'Autorisation refusée : activez les notifications dans les réglages du navigateur.';
    }
  }

  async disablePush(): Promise<void> {
    if (this.swPush?.isEnabled) {
      const subscription = await firstValueFrom(this.swPush.subscription.pipe(take(1)));
      if (subscription) {
        await firstValueFrom(this.http.delete(`${this.api}/push/`, { body: { endpoint: subscription.endpoint } }));
        await this.swPush.unsubscribe();
      }
    }
    this.pushEnabled.set(false);
  }

  private socketUrl(): string | null {
    const token = this.auth.accessToken;
    if (!token || typeof location === 'undefined') {
      return null;
    }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws/status/?token=${encodeURIComponent(token)}`;
  }

  private connect(): void {
    if (this.socket || typeof WebSocket === 'undefined') {
      return;
    }
    const url = this.socketUrl();
    if (!url) {
      return;
    }
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.connected.set(true);
    };
    socket.onmessage = (event) => this.onMessage(event.data as string);
    socket.onclose = (event) => {
      this.socket = null;
      this.connected.set(false);
      if (!this.started) {
        return;
      }
      if (event.code === 4401) {
        // Jeton d'accès expiré : on le renouvelle avant de se reconnecter.
        this.auth.refreshAccessToken().subscribe({ next: () => this.schedule(), error: () => undefined });
        return;
      }
      this.schedule();
    };
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.started && this.network.online() && this.auth.isAuthenticated()) {
        this.connect();
      }
    }, reconnectDelay(this.attempts++));
  }

  private disconnect(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.connected.set(false);
  }

  private onMessage(raw: string): void {
    let message: { type?: string; notification?: AppNotification; unread?: number };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === 'notification' && message.notification) {
      const notification = message.notification;
      this.items.update((list) => [notification, ...list.filter((n) => n.id !== notification.id)].slice(0, 50));
      this.unread.set(message.unread ?? this.unread() + 1);
      this.incoming.set(notification);
    }
  }
}
