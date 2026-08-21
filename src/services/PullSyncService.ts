import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { MaintenanceEvent, Transaction, Vehicle, WorkSession } from "@/types";

type RemoteVehicle = Omit<Vehicle, "sync_state" | "sync_error">;
type RemoteTransaction = Omit<Transaction, "sync_state" | "sync_error">;
type RemoteMaintenanceEvent = Omit<MaintenanceEvent, "sync_state" | "sync_error">;
type RemoteWorkSession = Omit<WorkSession, "sync_state" | "sync_error">;

type SyncTable = "vehicles" | "transactions" | "maintenance_events" | "work_sessions";

export type PullSyncResult = {
  vehicles: number;
  transactions: number;
  maintenance: number;
  workSessions: number;
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
    // Nunca remova um registro com intenção local de delete ainda pendente;
    // processPendingDeletes é responsável por finalizar esse fluxo.
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

  const [vehiclesResult, transactionsResult, maintenanceResult, workSessionsResult] = await Promise.all([
    supabase.from("vehicles").select("*").eq("user_id", userId),
    supabase.from("transactions").select("*").eq("user_id", userId),
    supabase.from("maintenance_events").select("*").eq("user_id", userId),
    supabase.from("work_sessions").select("*").eq("user_id", userId)
  ]);

  const firstError = vehiclesResult.error ?? transactionsResult.error ?? maintenanceResult.error ?? workSessionsResult.error;
  if (firstError) throw new Error(firstError.message);

  const remoteVehicles = (vehiclesResult.data ?? []) as RemoteVehicle[];
  const remoteTransactions = (transactionsResult.data ?? []) as RemoteTransaction[];
  const remoteMaintenance = (maintenanceResult.data ?? []) as RemoteMaintenanceEvent[];
  const remoteWorkSessions = (workSessionsResult.data ?? []) as RemoteWorkSession[];

  const db = await getDb();
  const result: PullSyncResult = { vehicles: 0, transactions: 0, maintenance: 0, workSessions: 0, removed: 0 };

  // Veículos vêm primeiro para preservar as FKs das demais tabelas durante inserts.
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
       (id, user_id, vehicle_id, description, cost, odometer_km, performed_at, created_at, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL)
       ON CONFLICT(id) DO UPDATE SET
         vehicle_id = excluded.vehicle_id, description = excluded.description, cost = excluded.cost,
         odometer_km = excluded.odometer_km, performed_at = excluded.performed_at,
         created_at = excluded.created_at, sync_state = 'synced', sync_error = NULL`,
      [remote.id, userId, remote.vehicle_id, remote.description, remote.cost, remote.odometer_km, remote.performed_at, remote.created_at]
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
      [remote.id, userId, remote.vehicle_id, remote.started_at, remote.ended_at,
        remote.start_odometer_km, remote.end_odometer_km, remote.created_at]
    );
    result.workSessions += 1;
  }

  // Depois dos upserts, refletimos deleções feitas em outro aparelho. Apenas
  // registros locais já sincronizados podem ser removidos: pending/error ficam intactos.
  // Filhos são reconciliados antes de vehicles para respeitar foreign keys.
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
    userId, "vehicles", new Set(remoteVehicles.map((item) => item.id))
  );

  return result;
}
