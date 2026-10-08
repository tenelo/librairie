export type RoleCode =
  | 'ADMIN'
  | 'GERANT'
  | 'CAISSIER'
  | 'MAGASINIER'
  | 'PREPARATEUR'
  | 'INVENTORISTE'
  | 'CLIENT';

export interface RoleSummary {
  code: RoleCode;
  label: string;
  is_staff_role: boolean;
  max_discount_percent: number;
}

export interface Role extends Omit<RoleSummary, 'code'> {
  id: number;
  code: RoleCode;
  description: string;
  permissions: string[];
  user_count: number;
}

export interface AppPermission {
  code: string;
  label: string;
  module: string;
}

export interface UserProfile {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: RoleSummary | null;
  permissions: string[];
  has_pin: boolean;
  offline_max_hours: number;
  must_change_password: boolean;
  is_superuser: boolean;
}

export interface TokenPair {
  access: string;
  refresh: string;
  user: UserProfile;
}

export interface StoredSession {
  access: string;
  refresh: string;
  user: UserProfile;
  /** Date (ISO) de la dernière authentification réussie auprès du serveur. */
  lastOnlineAuthAt: string;
}

export interface ManagedUser {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: RoleCode;
  role_label: string | null;
  is_active: boolean;
  offline_max_hours: number | null;
  must_change_password: boolean;
  has_pin: boolean;
  last_login: string | null;
  date_joined: string;
  password?: string;
}

export type DeviceKind = 'CAISSE' | 'TABLETTE' | 'POSTE';

export interface Device {
  id: string;
  code: string;
  name: string;
  kind: DeviceKind;
  depot: string | null;
  depot_code: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  last_sync_at: string | null;
  registered_by: string | null;
  registered_by_name: string | null;
  created_at: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
