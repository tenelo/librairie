export type ArticleType = 'SIMPLE' | 'KIT' | 'LOT' | 'SERVICE';
export type BarcodeKind = 'EAN13' | 'INTERNAL' | 'OTHER';
export type KitPricingMode = 'FIXED' | 'COMPUTED';
export type KitStockMode = 'VIRTUAL' | 'ASSEMBLED';
export type SchoolCycle = 'PRIMAIRE' | 'COLLEGE' | 'LYCEE';

export const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  SIMPLE: 'Article simple',
  KIT: 'Kit',
  LOT: 'Lot / conditionnement',
  SERVICE: 'Service',
};

export interface Category {
  id: string;
  name: string;
  parent: string | null;
  path: string;
  sort_order: number;
  is_active: boolean;
  article_count: number;
}

export interface Brand {
  id: string;
  name: string;
}

export interface Unit {
  id: string;
  code: string;
  label: string;
}

export interface Barcode {
  id?: string;
  code: string;
  kind: BarcodeKind;
}

export interface ArticleImage {
  id: string;
  image: string;
  sort_order: number;
}

export interface Article {
  id: string;
  code: string;
  name: string;
  description: string;
  type: ArticleType;
  type_label: string;
  category: string | null;
  category_path: string | null;
  brand: string | null;
  brand_name: string | null;
  unit: string | null;
  unit_label: string | null;
  avg_cost: number;
  retail_price: number;
  wholesale_price: number | null;
  wholesale_min_qty: number | null;
  vat_rate: string | null;
  vat_exempt: boolean;
  margin: number;
  alert_threshold: number;
  max_stock: number | null;
  is_active: boolean;
  is_online: boolean;
  lot_base_article: string | null;
  lot_base_article_name: string | null;
  lot_units: number | null;
  barcodes: Barcode[];
  images: ArticleImage[];
  kit_id: string | null;
  sync_version: number;
  updated_at: string;
}

export type ArticleInput = Partial<Omit<Article, 'id' | 'images' | 'margin'>> & { generate_barcode?: boolean };

export interface ArticleLookup {
  id: string;
  code: string;
  name: string;
  type: ArticleType;
  retail_price: number;
  avg_cost: number;
  is_active: boolean;
  barcode: string | null;
}

export interface PriceHistoryEntry {
  id: number;
  field: string;
  old_value: string;
  new_value: string;
  reason: string;
  changed_by_name: string | null;
  changed_at: string;
}

export interface SchoolLevel {
  id: string;
  code: string;
  label: string;
  cycle: SchoolCycle;
  cycle_label: string;
  series: string;
  sort_order: number;
  is_active: boolean;
}

export interface SchoolYear {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
}

export interface School {
  id: string;
  name: string;
  city: string;
  district: string;
  phone: string;
  is_active: boolean;
  kit_count: number;
}

export interface KitComponent {
  id?: string;
  article: string;
  article_code: string;
  article_name: string;
  article_type: ArticleType;
  unit_price: number;
  unit_cost: number;
  quantity: number;
  is_optional: boolean;
  sort_order: number;
  substitutes: string[];
  substitute_details: ArticleLookup[];
}

export interface KitPricingBreakdown {
  components_total: number;
  discount_percent: string;
  computed_price: number;
  price: number;
  cost: number;
  margin: number;
  margin_rate: string | null;
}

export interface Kit {
  id: string;
  article_id: string;
  code: string;
  name: string;
  description: string;
  category: string | null;
  retail_price: number;
  is_active: boolean;
  is_online: boolean;
  barcodes: Barcode[];
  level: string;
  level_label: string;
  school: string | null;
  school_name: string | null;
  school_year: string | null;
  school_year_label: string | null;
  pricing_mode: KitPricingMode;
  discount_percent: string;
  stock_mode: KitStockMode;
  notes: string;
  components: KitComponent[];
  pricing: KitPricingBreakdown;
  /** Kits vendables tous dépôts (composant le plus limitant, ou stock propre si pré-assemblé). */
  availability: number;
  sync_version: number;
  updated_at: string;
}

export interface KitComponentInput {
  article: string;
  quantity: number;
  is_optional: boolean;
  sort_order: number;
  substitutes: string[];
}

export interface KitInput {
  code?: string;
  name: string;
  description?: string;
  category?: string | null;
  retail_price?: number;
  is_active?: boolean;
  is_online?: boolean;
  level: string;
  school: string | null;
  school_year: string | null;
  pricing_mode: KitPricingMode;
  discount_percent: string;
  stock_mode: KitStockMode;
  notes?: string;
  components: KitComponentInput[];
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
  dry_run: boolean;
  applied: boolean;
}
