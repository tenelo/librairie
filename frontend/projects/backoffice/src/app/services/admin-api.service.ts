import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  APP_CONFIG,
  AppPermission,
  Device,
  LibrarySettings,
  ManagedUser,
  Paginated,
  Role,
} from '@librairie/shared';
import { Observable } from 'rxjs';

export interface AuditLogEntry {
  id: string;
  action: string;
  action_label: string;
  entity: string;
  entity_id: string;
  description: string;
  user: string | null;
  username: string;
  role_code: string;
  device: string | null;
  device_code: string | null;
  ip_address: string | null;
  server_timestamp: string;
  client_timestamp: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  origin: string;
  origin_label: string;
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

function toParams(query: QueryParams): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

/** Accès aux API d'administration (utilisateurs, rôles, terminaux, paramètres, audit). */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;

  listUsers(query: QueryParams): Observable<Paginated<ManagedUser>> {
    return this.http.get<Paginated<ManagedUser>>(`${this.api}/accounts/users/`, { params: toParams(query) });
  }

  createUser(user: Partial<ManagedUser>): Observable<ManagedUser> {
    return this.http.post<ManagedUser>(`${this.api}/accounts/users/`, user);
  }

  updateUser(id: string, user: Partial<ManagedUser>): Observable<ManagedUser> {
    return this.http.patch<ManagedUser>(`${this.api}/accounts/users/${id}/`, user);
  }

  setUserActive(id: string, active: boolean): Observable<ManagedUser> {
    return this.http.post<ManagedUser>(`${this.api}/accounts/users/${id}/${active ? 'activate' : 'deactivate'}/`, {});
  }

  resetUserPin(id: string): Observable<void> {
    return this.http.post<void>(`${this.api}/accounts/users/${id}/reset-pin/`, {});
  }

  listRoles(): Observable<Role[]> {
    return this.http.get<Role[]>(`${this.api}/accounts/roles/`);
  }

  updateRole(id: number, changes: Partial<Role>): Observable<Role> {
    return this.http.patch<Role>(`${this.api}/accounts/roles/${id}/`, changes);
  }

  listPermissions(): Observable<AppPermission[]> {
    return this.http.get<AppPermission[]>(`${this.api}/accounts/permissions/`);
  }

  listDevices(): Observable<Paginated<Device>> {
    return this.http.get<Paginated<Device>>(`${this.api}/accounts/devices/`, { params: { page_size: 500 } });
  }

  createDevice(device: Partial<Device>): Observable<Device> {
    return this.http.post<Device>(`${this.api}/accounts/devices/`, device);
  }

  updateDevice(id: string, device: Partial<Device>): Observable<Device> {
    return this.http.patch<Device>(`${this.api}/accounts/devices/${id}/`, device);
  }

  checkDevice(code: string): Observable<Device> {
    return this.http.get<Device>(`${this.api}/accounts/devices/check/`, { params: { code } });
  }

  getSettings(): Observable<LibrarySettings> {
    return this.http.get<LibrarySettings>(`${this.api}/settings/library/`);
  }

  updateSettings(changes: Partial<LibrarySettings>): Observable<LibrarySettings> {
    return this.http.patch<LibrarySettings>(`${this.api}/settings/library/`, changes);
  }

  listAuditLogs(query: QueryParams): Observable<Paginated<AuditLogEntry>> {
    return this.http.get<Paginated<AuditLogEntry>>(`${this.api}/audit/logs/`, { params: toParams(query) });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.api}/auth/me/password/`, {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  setPin(password: string, pin: string): Observable<void> {
    return this.http.post<void>(`${this.api}/auth/me/pin/`, { password, pin });
  }
}
