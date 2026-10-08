import { Injectable, effect, inject, untracked } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { StoredSession } from '../models/auth.models';
import { OfflineUser } from './local-db';
import { LocalDbService } from './local-db.service';

const PBKDF2_ITERATIONS = 150_000;

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16)));
}

/** Hache un PIN (PBKDF2-SHA-256, sel aléatoire par utilisateur) : le PIN n'est jamais stocké en clair. */
export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource,
    iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}

/** Une session hors ligne n'est permise que pendant la durée maximale depuis la dernière connexion en ligne. */
export function offlineWindowOpen(user: Pick<OfflineUser, 'lastOnlineAuthAt' | 'offlineMaxHours'>,
  now = Date.now()): boolean {
  const last = Date.parse(user.lastOnlineAuthAt);
  return Number.isFinite(last) && now - last <= user.offlineMaxHours * 3_600_000;
}

/**
 * Sessions hors connexion : mémorise sur le terminal le profil (rôle, permissions) et les jetons
 * de chaque utilisateur connecté, et permet de reprendre la main par PIN — y compris pour qu'un
 * autre caissier prenne le relais sur le même terminal.
 */
@Injectable({ providedIn: 'root' })
export class OfflineAuthService {
  private readonly auth = inject(AuthService);
  private readonly local = inject(LocalDbService);

  constructor() {
    // Chaque changement de session (connexion, jetons renouvelés, profil rechargé) est mémorisé.
    effect(() => {
      const session = this.auth.session();
      untracked(() => {
        if (session) {
          void this.remember(session);
        }
      });
    });
  }

  async remember(session: StoredSession): Promise<void> {
    const user = session.user;
    const existing = await this.local.db.users.get(user.id);
    await this.local.db.users.put({
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      roleLabel: user.role?.label ?? '',
      session,
      pinHash: user.has_pin ? existing?.pinHash ?? null : null,
      pinSalt: user.has_pin ? existing?.pinSalt ?? null : null,
      lastOnlineAuthAt: session.lastOnlineAuthAt,
      offlineMaxHours: user.offline_max_hours,
    });
  }

  /** Enregistre localement le PIN de l'utilisateur connecté (après définition ou vérification en ligne). */
  async setLocalPin(userId: string, pin: string): Promise<void> {
    const { hash, salt } = await hashPin(pin);
    await this.local.db.users.update(userId, { pinHash: hash, pinSalt: salt });
  }

  async hasLocalPin(userId: string): Promise<boolean> {
    return !!(await this.local.db.users.get(userId))?.pinHash;
  }

  /** Utilisateurs pouvant reprendre la main sur ce terminal (PIN connu, fenêtre hors ligne ouverte). */
  async unlockableUsers(now = Date.now()): Promise<OfflineUser[]> {
    const users = await this.local.db.users.toArray();
    return users.filter((u) => u.pinHash && offlineWindowOpen(u, now))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'));
  }

  /** Vérifie le PIN et rétablit la session de l'utilisateur. Renvoie false si le PIN est faux ou expiré. */
  async unlock(userId: string, pin: string, now = Date.now()): Promise<boolean> {
    const user = await this.local.db.users.get(userId);
    if (!user?.pinHash || !user.pinSalt || !offlineWindowOpen(user, now)) {
      return false;
    }
    const { hash } = await hashPin(pin, user.pinSalt);
    if (hash !== user.pinHash) {
      return false;
    }
    this.auth.restoreSession(user.session);
    return true;
  }

  async forget(userId: string): Promise<void> {
    await this.local.db.users.delete(userId);
  }
}
