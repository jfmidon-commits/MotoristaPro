// Tipos centrais do domínio do MotoristaPro

export type TransactionType = "income" | "expense";

export type SyncState = "pending" | "synced" | "error";

export interface Transaction {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  type: TransactionType;
  category: string;
  amount: number;
  description: string | null;
  occurred_at: string;
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
  sync_error: string | null;
}

export interface MaintenanceEvent {
  id: string;
  user_id: string;
  vehicle_id: string;
  description: string;
  cost: number;
  odometer_km: number | null;
  performed_at: string;
  created_at: string;
  sync_state: SyncState;
  sync_error: string | null;
}

export interface WorkSession {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  started_at: string;
  ended_at: string | null;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
  created_at: string;
  sync_state: SyncState;
  sync_error: string | null;
}

export interface PreventiveMaintenancePlan {
  id: string;
  user_id: string;
  vehicle_id: string;
  category: string;
  interval_km: number | null;
  interval_days: number | null;
  warning_km: number | null;
  warning_days: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  sync_state: SyncState;
  sync_error: string | null;
}

export type PreventiveMaintenanceStatusLabel = "ok" | "soon" | "overdue" | "unknown";

export interface PreventiveMaintenanceOverview {
  plan: PreventiveMaintenancePlan;
  lastEvent: MaintenanceEvent | null;
  currentOdometerKm: number | null;
  remainingKm: number | null;
  remainingDays: number | null;
  status: PreventiveMaintenanceStatusLabel;
}

export interface PendingDelete {
  id: string;
  user_id: string;
  table_name: string;
  record_id: string;
  created_at: string;
  sync_state: SyncState;
  sync_error: string | null;
  attempts: number;
}

export interface SyncStatusSnapshot {
  pendingTransactions: number;
  pendingVehicles: number;
  pendingMaintenance: number;
  pendingWorkSessions: number;
  pendingPreventiveMaintenance: number;
  pendingDeletes: number;
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
