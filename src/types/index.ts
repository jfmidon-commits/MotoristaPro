// Tipos centrais do domínio do MotoristaPro

export type TransactionType = "income" | "expense";

export type SyncState = "pending" | "synced" | "error";

export interface Transaction {
  id: string; // uuid local, também usado como PK no Supabase
  user_id: string;
  vehicle_id: string | null;
  type: TransactionType;
  category: string;
  amount: number; // sempre em centavos (evita erro de ponto flutuante)
  description: string | null;
  occurred_at: string; // ISO string
  created_at: string;
  sync_state: SyncState;
  sync_error: string | null;
}

export interface Vehicle {
  id: string;
  user_id: string;
  name: string;
  plate: string | null;
  is_default: boolean;
  created_at: string;
  sync_state: SyncState;
}

export interface MaintenanceEvent {
  id: string;
  user_id: string;
  vehicle_id: string; // NUNCA null — manutenção sempre aponta pra um veículo real
  description: string;
  cost: number; // centavos
  odometer_km: number | null;
  performed_at: string;
  created_at: string;
  sync_state: SyncState;
}

export interface SyncStatusSnapshot {
  pendingTransactions: number;
  pendingVehicles: number;
  pendingMaintenance: number;
  lastSyncAttemptAt: string | null;
  lastSyncSuccessAt: string | null;
  lastError: string | null;
}

export interface SupabaseErrorShape {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}
