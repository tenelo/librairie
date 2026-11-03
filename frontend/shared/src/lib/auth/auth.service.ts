import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { StoredSession, TokenPair, UserProfile } from '../models/auth.models';
import { SessionStorageService } from './session-storage.service';

export interface RegisterPayload {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string;
  password: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly config = inject(APP_CONFIG);
  private readonly storage = inject(SessionStorageService);

  private readonly sessionState = signal<StoredSession | null>(this.storage.read());
  /** Session courante (lecture seule) : mémorisée par le terminal pour la reprise hors ligne. */
  readonly session = this.sessionState.asReadonly();
  private refreshInFlight: Observable<string> | null = null;

  readonly user = computed<UserProfile | null>(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly permissions = computed(() => new Set(this.user()?.permissions ?? []));

  get accessToken(): string | null {
    return this.session()?.access ?? null;
  }

  hasPermission(code: string | null | undefined): boolean {
    if (!code) {
      return this.isAuthenticated();
    }
    const user = this.user();
    return !!user && (user.is_superuser || this.permissions().has(code));
  }

  hasAnyPermission(codes: readonly string[]): boolean {
    return codes.length === 0 || codes.some((code) => this.hasPermission(code));
  }

  login(identifier: string, password: string): Observable<UserProfile> {
    return this.http
      .post<TokenPair>(`${this.config.apiBaseUrl}/auth/login/`, {
        identifier,
        password,
        app: this.config.app,
      })
      .pipe(
        tap((pair) => this.store(pair)),
        map((pair) => pair.user),
      );
  }

  register(payload: RegisterPayload): Observable<UserProfile> {
    return this.http.post<TokenPair>(`${this.config.apiBaseUrl}/auth/register/`, payload).pipe(
      tap((pair) => this.store(pair)),
      map((pair) => pair.user),
    );
  }

  /** Recharge le profil (rôle, permissions) depuis le serveur. */
  reloadProfile(): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.config.apiBaseUrl}/auth/me/`).pipe(
      tap((user) => {
        const current = this.session();
        if (current) {
          this.persist({ ...current, user, lastOnlineAuthAt: new Date().toISOString() });
        }
      }),
    );
  }

  /**
   * Renouvelle le jeton d'accès. Les appels concurrents partagent la même requête :
   * avec la rotation des jetons de rafraîchissement, deux renouvellements parallèles
   * invalideraient la session.
   */
  refreshAccessToken(): Observable<string> {
    const current = this.session();
    if (!current) {
      return throwError(() => new Error('Aucune session'));
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.http
        .post<{ access: string; refresh?: string }>(`${this.config.apiBaseUrl}/auth/refresh/`, {
          refresh: current.refresh,
        })
        .pipe(
          map((tokens) => {
            const latest = this.session() ?? current;
            this.persist({ ...latest, access: tokens.access, refresh: tokens.refresh ?? latest.refresh,
              lastOnlineAuthAt: new Date().toISOString() });
            return tokens.access;
          }),
          finalize(() => (this.refreshInFlight = null)),
          shareReplay(1),
        );
    }
    return this.refreshInFlight;
  }

  logout(redirect = true): void {
    const current = this.session();
    this.clearSession();
    if (current) {
      this.http
        .post(`${this.config.apiBaseUrl}/auth/logout/`, { refresh: current.refresh }, {
          headers: { Authorization: `Bearer ${current.access}` },
        })
        .pipe(catchError(() => of(null)))
        .subscribe();
    }
    if (redirect) {
      void this.router.navigateByUrl(this.config.loginPath);
    }
  }

  /** Rétablit une session mémorisée sur le terminal (reprise hors ligne par PIN, relais de caissier). */
  restoreSession(session: StoredSession): void {
    this.persist(session);
  }

  /** Efface la session locale sans appel serveur (jeton expiré, refus du serveur). */
  clearSession(): void {
    this.storage.clear();
    this.sessionState.set(null);
  }

  private store(pair: TokenPair): void {
    this.persist({
      access: pair.access,
      refresh: pair.refresh,
      user: pair.user,
      lastOnlineAuthAt: new Date().toISOString(),
    });
  }

  private persist(session: StoredSession): void {
    this.storage.write(session);
    this.sessionState.set(session);
  }
}
