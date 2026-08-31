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
  preventive_plan_id: string | null;
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

export type RidePlatform = "uber" | "99" | "indrive" | "other";
export type CaptureSource = "manual" | "notification" | "accessibility" | "screenshot" | "fixture" | "other";
export type DecisionLabel = "good" | "borderline" | "bad";

export interface RideOffer {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  work_session_id: string | null;
  platform: RidePlatform;
  category: string | null;
  captured_at: string;
  offered_amount: number;
  pickup_distance_km: number | null;
  pickup_duration_minutes: number | null;
  trip_distance_km: number | null;
  trip_duration_minutes: number | null;
  total_expected_distance_km: number | null;
  total_expected_duration_minutes: number | null;
  approximate_origin_zone: string | null;
  approximate_destination_zone: string | null;
  additional_pay: number;
  capture_source: CaptureSource;
  extraction_confidence: number | null;
  estimated_cost: number | null;
  expected_net_profit: number | null;
  expected_net_per_km: number | null;
  expected_net_per_hour: number | null;
  decision_label: DecisionLabel | null;
  decision_score: number | null;
  decision_reasons_positive_json: string | null;
  decision_reasons_negative_json: string | null;
  decision_confidence: number | null;
  created_at: string;
  sync_state: SyncState;
  sync_error: string | null;
}

export interface RideResult {
  id: string;
  ride_offer_id: string;
  user_id: string;
  vehicle_id: string | null;
  final_amount: number;
  actual_distance_km: number | null;
  actual_duration_minutes: number | null;
  started_at: string | null;
  ended_at: string | null;
  estimated_cost: number | null;
  net_profit: number | null;
  net_per_km: number | null;
  net_per_hour: number | null;
  created_at: string;
  sync_state: SyncState;
  sync_error: string | null;
}

export interface SyncStatusSnapshot {
  pendingTransactions: number;
  pendingVehicles: number;
  pendingMaintenance: number;
  pendingWorkSessions: number;
  pendingPreventiveMaintenance: number;
  pendingRideOffers: number;
  pendingRideResults: number;
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
