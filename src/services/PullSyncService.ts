import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type {
  MaintenanceEvent,
  PreventiveMaintenancePlan,
  RideOffer,
  RideResult,
  Transaction,
  Vehicle,
  WorkSession
} from "@/types";

type RemoteVehicle = Omit<Vehicle, "sync_state" | "sync_error">;
type RemoteTransaction = Omit<Transaction, "sync_state" | "sync_error">;
type RemoteMaintenanceEvent = Omit<MaintenanceEvent, "sync_state" | "sync_error">;
type RemoteWorkSession = Omit<WorkSession, "sync_state" | "sync_error">;
type RemotePreventivePlan = Omit<PreventiveMaintenancePlan, "sync_state" | "sync_error">;
type RemoteRideOffer = Omit<RideOffer, "sync_state" | "sync_error">;
type RemoteRideResult = Omit<RideResult, "sync_state" | "sync_error">;

type SyncTable =
  | "vehicles"
  | "transactions"
  | "maintenance_events"
  | "work_sessions"
  | "preventive_maintenance_plans"
  | "ride_offers"
  | "ride_results";

export type PullSyncResult = {
  vehicles: number;
  transactions: number;
  maintenance: number;
  workSessions: number;
  preventiveMaintenance: number;
  rideOffers: number;
  rideResults: number;
  removed: number;
};

async function hasPendingDelete(userId: string, tableName: string, recordId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM pending_deletes
     WHERE user_id = ? AND table_name = ? AND record_id = ?`,
    [userId, tableName, recordId]
  );
  return (row?.count ?? 0) > 0;
}

async function shouldAcceptRemote(
  userId: string,
  tableName: string,
  recordId: string,
  localSyncState: string | null | undefined
): Promise<boolean> {
  if (await hasPendingDelete(userId, tableName, recordId)) return false;
  return !localSyncState || localSyncState === "synced";
}

async function reconcileRemoteDeletes(
  userId: string,
  tableName: SyncTable,
  remoteIds: Set<string>
): Promise<number> {
  const db = await getDb();
  const localSynced = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM ${tableName} WHERE user_id = ? AND sync_state = 'synced'`,
    [userId]
  );

  let removed = 0;
  for (const local of localSynced) {
    if (remoteIds.has(local.id)) continue;
    if (await hasPendingDelete(userId, tableName, local.id)) continue;
    await db.runAsync(`DELETE FROM ${tableName} WHERE id = ? AND user_id = ? AND sync_state = 'synced'`, [
      local.id,
      userId
    ]);
    removed += 1;
  }
  return removed;
}

export async function pullRemoteState(userId: string): Promise<PullSyncResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user || session.user.id !== userId) {
    throw new Error("Sessão autenticada inválida para sincronização remota.");
  }

  const [
    vehiclesResult,
    transactionsResult,
    maintenanceResult,
    workSessionsResult,
    preventiveResult,
    rideOffersResult,
    rideResultsResult
  ] = await Promise.all([
    supabase.from("vehicles").select("*").eq("user_id", userId),
    supabase.from("transactions").select("*").eq("user_id", userId),
    supabase.from("maintenance_events").select("*").eq("user_id", userId),
    supabase.from("work_sessions").select("*").eq("user_id", userId),
    supabase.from("preventive_maintenance_plans").select("*").eq("user_id", userId),
    supabase.from("ride_offers").select("*").eq("user_id", userId),
    supabase.from("ride_results").select("*").eq("user_id", userId)
  ]);

  const firstError =
    vehiclesResult.error ??
    transactionsResult.error ??
    maintenanceResult.error ??
    workSessionsResult.error ??
    preventiveResult.error ??
    rideOffersResult.error ??
    rideResultsResult.error;
  if (firstError) throw new Error(firstError.message);

  const remoteVehicles = (vehiclesResult.data ?? []) as RemoteVehicle[];
  const remoteTransactions = (transactionsResult.data ?? []) as RemoteTransaction[];
  const remoteMaintenance = (maintenanceResult.data ?? []) as RemoteMaintenanceEvent[];
  const remoteWorkSessions = (workSessionsResult.data ?? []) as RemoteWorkSession[];
  const remotePreventive = (preventiveResult.data ?? []) as RemotePreventivePlan[];
  const remoteRideOffers = (rideOffersResult.data ?? []) as RemoteRideOffer[];
  const remoteRideResults = (rideResultsResult.data ?? []) as RemoteRideResult[];

  const db = await getDb();
  const result: PullSyncResult = {
    vehicles: 0,
    transactions: 0,
    maintenance: 0,
    workSessions: 0,
    preventiveMaintenance: 0,
    rideOffers: 0,
    rideResults: 0,
    removed: 0
  };

  for (const remote of remoteVehicles) {
    const local = await db.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM vehicles WHERE id = ? AND user_id = ?`, [remote.id, userId]
    );
    if (!(await shouldAcceptRemote(userId, "vehicles", remote.id, local?.sync_state))) continue;
    await db.runAsync(
      `INSERT INTO vehicles (id, user_id, name, plate, is_default, created_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, 'synced', NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, plate = excluded.plate, is_default = excluded.is_default,
         created_at = excluded.created_at, sync_state = 'synced', sync_error = NULL`,
      [remote.id, userId, remote.name, remote.plate, remote.is_default ? 1 : 0, remote.created_at]
    );
    result.vehicles += 1;
  }

  for (const remote of remoteTransactions) {
    const local = await db.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM transactions WHERE id = ? AND user_id = ?`, [remote.id, userId]
    );
    if (!(await shouldAcceptRemote(userId, "transactions", remote.id, local?.sync_state))) continue;
    await db.runAsync(
      `INSERT INTO transactions
       (id, user_id, vehicle_id, type, category, amount, description, occurred_at, created_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL)
       ON CONFLICT(id) DO UPDATE SET
         vehicle_id = excluded.vehicle_id, type = excluded.type, category = excluded.category,
         amount = excluded.amount, description = excluded.description, occurred_at = excluded.occurred_at,
         created_at = excluded.created_at, sync_state = 'synced', sync_error = NULL`,
      [remote.id, userId, remote.vehicle_id, remote.type, remote.category, remote.amount, remote.description, remote.occurred_at, remote.created_at]
    );
    result.transactions += 1;
  }

  for (const remote of remoteMaintenance) {
    const local = await db.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM maintenance_events WHERE id = ? AND user_id = ?`, [remote.id, userId]
    );
    if (!(await shouldAcceptRemote(userId, "maintenance_events", remote.id, local?.sync_state))) continue;
    await db.runAsync(
      `INSERT INTO maintenance_events
       (id, user_id, vehicle_id, preventive_plan_id, description, cost, odometer_km, performed_at, created_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL)
       ON CONFLICT(id) DO UPDATE SET
         vehicle_id = excluded.vehicle_id, preventive_plan_id = excluded.preventive_plan_id,
         description = excluded.description, cost = excluded.cost,
         odometer_km = excluded.odometer_km, performed_at = excluded.performed_at,
         created_at = excluded.created_at, sync_state = 'synced', sync_error = NULL`,
      [remote.id, userId, remote.vehicle_id, remote.preventive_plan_id ?? null, remote.description, remote.cost, remote.odometer_km, remote.performed_at, remote.created_at]
    );
    result.maintenance += 1;
  }

  for (const remote of remoteWorkSessions) {
    const local = await db.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM work_sessions WHERE id = ? AND user_id = ?`, [remote.id, userId]
    );
    if (!(await shouldAcceptRemote(userId, "work_sessions", remote.id, local?.sync_state))) continue;
    await db.runAsync(
      `INSERT INTO work_sessions
       (id, user_id, vehicle_id, started_at, ended_at, start_odometer_km, end_odometer_km, created_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL)
       ON CONFLICT(id) DO UPDATE SET
         vehicle_id = excluded.vehicle_id, started_at = excluded.started_at, ended_at = excluded.ended_at,
         start_odometer_km = excluded.start_odometer_km, end_odometer_km = excluded.end_odometer_km,
         created_at = excluded.created_at, sync_state = 'synced', sync_error = NULL`,
      [
        remote.id,
        userId,
        remote.vehicle_id,
        remote.started_at,
        remote.ended_at,
        remote.start_odometer_km,
        remote.end_odometer_km,
        remote.created_at
      ]
    );
    result.workSessions += 1;
  }

  for (const remote of remotePreventive) {
    const local = await db.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM preventive_maintenance_plans WHERE id = ? AND user_id = ?`,
      [remote.id, userId]
    );
    if (!(await shouldAcceptRemote(userId, "preventive_maintenance_plans", remote.id, local?.sync_state))) continue;
    await db.runAsync(
      `INSERT INTO preventive_maintenance_plans
       (id, user_id, vehicle_id, category, interval_km, interval_days, warning_km, warning_days,
        is_active, created_at, updated_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL)
       ON CONFLICT(id) DO UPDATE SET
         vehicle_id = excluded.vehicle_id, category = excluded.category,
         interval_km = excluded.interval_km, interval_days = excluded.interval_days,
         warning_km = excluded.warning_km, warning_days = excluded.warning_days,
         is_active = excluded.is_active, created_at = excluded.created_at, updated_at = excluded.updated_at,
         sync_state = 'synced', sync_error = NULL`,
      [
        remote.id,
        userId,
        remote.vehicle_id,
        remote.category,
        remote.interval_km,
        remote.interval_days,
        remote.warning_km,
        remote.warning_days,
        remote.is_active ? 1 : 0,
        remote.created_at,
        remote.updated_at
      ]
    );
    result.preventiveMaintenance += 1;
  }

  for (const remote of remoteRideOffers) {
    const local = await db.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM ride_offers WHERE id = ? AND user_id = ?`, [remote.id, userId]
    );
    if (!(await shouldAcceptRemote(userId, "ride_offers", remote.id, local?.sync_state))) continue;
    await db.runAsync(
      `INSERT INTO ride_offers
       (id, user_id, vehicle_id, work_session_id, platform, category, captured_at, offered_amount,
        pickup_distance_km, pickup_duration_minutes, trip_distance_km, trip_duration_minutes,
        total_expected_distance_km, total_expected_duration_minutes, approximate_origin_zone,
        approximate_destination_zone, additional_pay, capture_source, extraction_confidence,
        estimated_cost, expected_net_profit, expected_net_per_km, expected_net_per_hour,
        decision_label, decision_score, decision_reasons_positive_json,
        decision_reasons_negative_json, decision_confidence, created_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL)
       ON CONFLICT(id) DO UPDATE SET
         vehicle_id = excluded.vehicle_id, work_session_id = excluded.work_session_id,
         platform = excluded.platform, category = excluded.category, captured_at = excluded.captured_at,
         offered_amount = excluded.offered_amount, pickup_distance_km = excluded.pickup_distance_km,
         pickup_duration_minutes = excluded.pickup_duration_minutes, trip_distance_km = excluded.trip_distance_km,
         trip_duration_minutes = excluded.trip_duration_minutes,
         total_expected_distance_km = excluded.total_expected_distance_km,
         total_expected_duration_minutes = excluded.total_expected_duration_minutes,
         approximate_origin_zone = excluded.approximate_origin_zone,
         approximate_destination_zone = excluded.approximate_destination_zone,
         additional_pay = excluded.additional_pay, capture_source = excluded.capture_source,
         extraction_confidence = excluded.extraction_confidence, estimated_cost = excluded.estimated_cost,
         expected_net_profit = excluded.expected_net_profit, expected_net_per_km = excluded.expected_net_per_km,
         expected_net_per_hour = excluded.expected_net_per_hour, decision_label = excluded.decision_label,
         decision_score = excluded.decision_score,
         decision_reasons_positive_json = excluded.decision_reasons_positive_json,
         decision_reasons_negative_json = excluded.decision_reasons_negative_json,
         decision_confidence = excluded.decision_confidence, created_at = excluded.created_at,
         sync_state = 'synced', sync_error = NULL`,
      [
        remote.id, userId, remote.vehicle_id, remote.work_session_id, remote.platform, remote.category,
        remote.captured_at, remote.offered_amount, remote.pickup_distance_km, remote.pickup_duration_minutes,
        remote.trip_distance_km, remote.trip_duration_minutes, remote.total_expected_distance_km,
        remote.total_expected_duration_minutes, remote.approximate_origin_zone,
        remote.approximate_destination_zone, remote.additional_pay, remote.capture_source,
        remote.extraction_confidence, remote.estimated_cost, remote.expected_net_profit,
        remote.expected_net_per_km, remote.expected_net_per_hour, remote.decision_label,
        remote.decision_score, remote.decision_reasons_positive_json,
        remote.decision_reasons_negative_json, remote.decision_confidence, remote.created_at
      ]
    );
    result.rideOffers += 1;
  }

  for (const remote of remoteRideResults) {
    const local = await db.getFirstAsync<{ sync_state: string }>(
      `SELECT sync_state FROM ride_results WHERE id = ? AND user_id = ?`, [remote.id, userId]
    );
    if (!(await shouldAcceptRemote(userId, "ride_results", remote.id, local?.sync_state))) continue;
    await db.runAsync(
      `INSERT INTO ride_results
       (id, ride_offer_id, user_id, vehicle_id, final_amount, actual_distance_km,
        actual_duration_minutes, started_at, ended_at, estimated_cost, net_profit,
        net_per_km, net_per_hour, created_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL)
       ON CONFLICT(id) DO UPDATE SET
         ride_offer_id = excluded.ride_offer_id, vehicle_id = excluded.vehicle_id,
         final_amount = excluded.final_amount, actual_distance_km = excluded.actual_distance_km,
         actual_duration_minutes = excluded.actual_duration_minutes, started_at = excluded.started_at,
         ended_at = excluded.ended_at, estimated_cost = excluded.estimated_cost,
         net_profit = excluded.net_profit, net_per_km = excluded.net_per_km,
         net_per_hour = excluded.net_per_hour, created_at = excluded.created_at,
         sync_state = 'synced', sync_error = NULL`,
      [
        remote.id, remote.ride_offer_id, userId, remote.vehicle_id, remote.final_amount,
        remote.actual_distance_km, remote.actual_duration_minutes, remote.started_at, remote.ended_at,
        remote.estimated_cost, remote.net_profit, remote.net_per_km, remote.net_per_hour, remote.created_at
      ]
    );
    result.rideResults += 1;
  }

  result.removed += await reconcileRemoteDeletes(
    userId, "ride_results", new Set(remoteRideResults.map((item) => item.id))
  );
  result.removed += await reconcileRemoteDeletes(
    userId, "ride_offers", new Set(remoteRideOffers.map((item) => item.id))
  );
  result.removed += await reconcileRemoteDeletes(
    userId, "transactions", new Set(remoteTransactions.map((item) => item.id))
  );
  result.removed += await reconcileRemoteDeletes(
    userId, "maintenance_events", new Set(remoteMaintenance.map((item) => item.id))
  );
  result.removed += await reconcileRemoteDeletes(
    userId, "work_sessions", new Set(remoteWorkSessions.map((item) => item.id))
  );
  result.removed += await reconcileRemoteDeletes(
    userId, "preventive_maintenance_plans", new Set(remotePreventive.map((item) => item.id))
  );
  result.removed += await reconcileRemoteDeletes(
    userId, "vehicles", new Set(remoteVehicles.map((item) => item.id))
  );

  return result;
}
