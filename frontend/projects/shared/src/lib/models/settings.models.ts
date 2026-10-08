export interface PublicLibrarySettings {
  name: string;
  logo: string | null;
  address: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  order_expiry_hours: number;
}

export interface LibrarySettings extends PublicLibrarySettings {
  id: string;
  taxpayer_number: string;
  trade_register: string;
  receipt_header: string;
  receipt_footer: string;
  vat_enabled: boolean;
  default_vat_rate: string;
  offline_max_hours: number;
  sync_interval_minutes: number;
  loyalty_points_per_1000: number;
  price_rounding: number;
  currency: { code: string; label: string; decimals: number };
  sync_version: number;
  updated_at: string;
}
