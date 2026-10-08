export type DepotKind = 'BOUTIQUE' | 'RESERVE';
export type StockStatus = 'OK' | 'LOW' | 'OUT';
export type MovementKind =
  | 'PURCHASE'
  | 'SALE'
  | 'CUSTOMER_RETURN'
  | 'SUPPLIER_RETURN'
  | 'ADJUSTMENT'
  | 'LOSS'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ASSEMBLY_IN'
  | 'ASSEMBLY_OUT'
  | 'DISASSEMBLY_IN'
  | 'DISASSEMBLY_OUT'
  | 'RESERVATION'
  | 'RESERVATION_RELEASE'
  | 'OPENING';

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  PURCHASE: 'Réception fournisseur',
  SALE: 'Vente',
  CUSTOMER_RETURN: 'Retour client',
  SUPPLIER_RETURN: 'Retour fournisseur',
  ADJUSTMENT: "Ajustement d'inventaire",
  LOSS: 'Perte / casse',
  TRANSFER_OUT: 'Transfert sortant',
  TRANSFER_IN: 'Transfert entrant',
  ASSEMBLY_IN: 'Assemblage (kit produit)',
  ASSEMBLY_OUT: 'Assemblage (composant consommé)',
  DISASSEMBLY_IN: 'Désassemblage (composant récupéré)',
  DISASSEMBLY_OUT: 'Désassemblage (kit défait)',
  RESERVATION: 'Réservation commande en ligne',
  RESERVATION_RELEASE: 'Libération de réservation',
  OPENING: 'Stock initial',
};

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  OK: 'Disponible',
  LOW: 'Stock bas',
  OUT: 'Rupture',
};

export interface Depot {
  id: string;
  code: string;
  name: string;
  kind: DepotKind;
  kind_label: string;
  address: string;
  is_pickup_point: boolean;
  is_default: boolean;
  is_active: boolean;
}

export interface StockStateRow {
  id: string;
  code: string;
  name: string;
  type: string;
  category_path: string | null;
  alert_threshold: number;
  max_stock: number | null;
  avg_cost: number;
  retail_price: number;
  quantity: number;
  reserved: number;
  available: number;
  value: number;
  status: StockStatus;
}

export interface StockMovement {
  id: string;
  article: string;
  article_code: string;
  article_name: string;
  depot: string;
  depot_code: string;
  kind: MovementKind;
  kind_label: string;
  quantity: number;
  unit_cost: number;
  reference: string;
  reason: string;
  source_type: string;
  source_id: string;
  user_name: string | null;
  occurred_at: string;
  client_timestamp: string | null;
}

export interface StockCardLine {
  movement: StockMovement;
  balance: number;
}

export interface StockSummary {
  valuation: number;
  low: number;
  out: number;
}

export interface StockAdjustmentInput {
  article: string;
  depot: string;
  kind: 'LOSS' | 'ADJUSTMENT' | 'OPENING';
  quantity: number;
  reason: string;
}

export type TransferStatus = 'DRAFT' | 'VALIDATED' | 'CANCELLED';

export interface StockTransferLine {
  id?: string;
  article: string;
  article_code?: string;
  article_name?: string;
  quantity: number;
}

export interface StockTransfer {
  id: string;
  number: string;
  from_depot: string;
  from_depot_name: string;
  to_depot: string;
  to_depot_name: string;
  status: TransferStatus;
  status_label: string;
  note: string;
  lines: StockTransferLine[];
  created_by_name: string | null;
  validated_by_name: string | null;
  validated_at: string | null;
  created_at: string;
}

export interface StockTransferInput {
  from_depot: string;
  to_depot: string;
  note: string;
  lines: { article: string; quantity: number }[];
}

export type AssemblyOperation = 'ASSEMBLE' | 'DISASSEMBLE';

export interface KitAssembly {
  id: string;
  number: string;
  kit: string;
  kit_name: string;
  kit_code: string;
  depot: string;
  depot_code: string;
  operation: AssemblyOperation;
  operation_label: string;
  quantity: number;
  note: string;
  user_name: string | null;
  created_at: string;
}

export interface StockAlert {
  id: string;
  article: string;
  article_code: string;
  article_name: string;
  kind: 'LOW' | 'OUT';
  kind_label: string;
  available: number;
  threshold: number;
  created_at: string;
  resolved_at: string | null;
}
