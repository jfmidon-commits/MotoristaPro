import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { queueDelete } from "@/services/TransactionService";
import { getMaintenanceEvents } from "@/services/MaintenanceService";
import { calculatePreventivePlanStatus } from "@/services/PreventivePlanStatus";
import type {
  MaintenanceEvent,
  PreventiveMaintenanceOverview,
  PreventiveMaintenancePlan
} from "@/types";

type PreventivePlanRow = Omit<PreventiveMaintenancePlan, "is_active"> & {
  is_active: number | boolean;
};

function mapPlanRow(row: PreventivePlanRow): PreventiveMaintenancePlan {
  return {
    ...row,
    is_active: row.is_active === true || row.is_active === 1,
    sync_error: row.sync_error ?? null
  };
}

function validateIntervals(params: {
  intervalKm?: number | null;
  intervalDays?: number | null;
  warningKm?: number | null;
  warningDays?: number | null;
}) {
  const hasKm = params.intervalKm != null;
  const hasDays = params.intervalDays != null;

  if (!hasKm && !hasDays) {
    throw new Error("Informe um intervalo em km ou dias.");
  }
  if (hasKm && (params.intervalKm as number) <= 0) {
    throw new Error("Intervalo em km deve ser maior que zero.");
  }
  if (hasDays && (params.intervalDays as number) <= 0) {
    throw new Error("Intervalo em dias deve ser maior que zero.");
  }
  if (params.warningKm != null && params.warningKm < 0) {
    throw new Error("Aviso em km não pode ser negativo.");
  }
  if (params.warningDays != null && params.warningDays < 0) {
    throw new Error("Aviso em dias não pode ser negativo.");
  }
}

function normalizeCategory(category: string): string {
  const value = category.trim();
  if (!value) throw new Error("Categoria do plano é obrigatória.");
  return value;
}

export async function createPreventiveMaintenancePlan(params: {
  userId: string;
  vehicleId: string;
  category: string;
  intervalKm?: number | null;
  intervalDays?: number | null;
  warningKm?: number | null;
  warningDays?: number | null;
}): Promise<PreventiveMaintenancePlan> {
  validateIntervals(params);
  const category = normalizeCategory(params.category);
  const db = await getDb();

  const vehicle = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM vehicles WHERE id = ? AND user_id = ? LIMIT 1`,
    [params.vehicleId, params.userId]
  );
  if (!vehicle) throw new Error("Veículo não encontrado para este usuário.");

  const now = new Date().toISOString();
  const plan: PreventiveMaintenancePlan = {
    id: uuidv4(),
    user_id: params.userId,
    vehicle_id: params.vehicleId,
    category,
    interval_km: params.intervalKm ?? null,
    interval_days: params.intervalDays ?? null,
    warning_km: params.warningKm ?? null,
    warning_days: params.warningDays ?? null,
    is_active: true,
    created_at: now,
    updated_at: now,
    sync_state: "pending",
    sync_error: null
  };

  await db.runAsync(
    `INSERT INTO preventive_maintenance_plans
      (id, user_id, vehicle_id, category, interval_km, interval_days, warning_km, warning_days,
       is_active, created_at, updated_at, sync_state, sync_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', NULL)`,
    [
      plan.id,
      plan.user_id,
      plan.vehicle_id,
      plan.category,
      plan.interval_km,
      plan.interval_days,
      plan.warning_km,
      plan.warning_days,
      plan.created_at,
      plan.updated_at
    ]
  );

  await syncPreventiveMaintenancePlan(plan);
  return plan;
}

export async function updatePreventiveMaintenancePlan(params: {
  userId: string;
  planId: string;
  category: string;
  intervalKm?: number | null;
  intervalDays?: number | null;
  warningKm?: number | null;
  warningDays?: number | null;
}): Promise<PreventiveMaintenancePlan> {
  validateIntervals(params);
  const category = normalizeCategory(params.category);
  const existing = await getPreventiveMaintenancePlanById(params.userId, params.planId);
  if (!existing) throw new Error("Plano preventivo não encontrado.");

  const updated: PreventiveMaintenancePlan = {
    ...existing,
    category,
    interval_km: params.intervalKm ?? null,
    interval_days: params.intervalDays ?? null,
    warning_km: params.warningKm ?? null,
    warning_days: params.warningDays ?? null,
    updated_at: new Date().toISOString(),
    sync_state: "pending",
    sync_error: null
  };

  const db = await getDb();
  await db.runAsync(
    `UPDATE preventive_maintenance_plans
     SET category = ?, interval_km = ?, interval_days = ?, warning_km = ?, warning_days = ?,
         updated_at = ?, sync_state = 'pending', sync_error = NULL
     WHERE id = ? AND user_id = ?`,
    [
      updated.category,
      updated.interval_km,
      updated.interval_days,
      updated.warning_km,
      updated.warning_days,
      updated.updated_at,
      updated.id,
      params.userId
    ]
  );

  await syncPreventiveMaintenancePlan(updated);
  return updated;
}

export async function setPreventiveMaintenancePlanActive(
  userId: string,
  planId: string,
  isActive: boolean
): Promise<void> {
  const existing = await getPreventiveMaintenancePlanById(userId, planId);
  if (!existing) throw new Error("Plano preventivo não encontrado.");

  const updated = {
    ...existing,
    is_active: isActive,
    updated_at: new Date().toISOString(),
    sync_state: "pending" as const,
    sync_error: null
  };

  const db = await getDb();
  await db.runAsync(
    `UPDATE preventive_maintenance_plans
     SET is_active = ?, updated_at = ?, sync_state = 'pending', sync_error = NULL
     WHERE id = ? AND user_id = ?`,
    [isActive ? 1 : 0, updated.updated_at, planId, userId]
  );
  await syncPreventiveMaintenancePlan(updated);
}

export async function deletePreventiveMaintenancePlan(userId: string, planId: string): Promise<void> {
  try {
    const { error } = await supabase.from("preventive_maintenance_plans").delete().eq("id", planId);
    if (error) {
      await queueDelete({ userId, tableName: "preventive_maintenance_plans", recordId: planId });
      return;
    }
  } catch {
    await queueDelete({ userId, tableName: "preventive_maintenance_plans", recordId: planId });
    return;
  }

  const db = await getDb();
  await db.runAsync(`DELETE FROM preventive_maintenance_plans WHERE id = ? AND user_id = ?`, [planId, userId]);
  await db.runAsync(
    `DELETE FROM pending_deletes
     WHERE user_id = ? AND table_name = 'preventive_maintenance_plans' AND record_id = ?`,
    [userId, planId]
  );
}

export async function syncPreventiveMaintenancePlan(plan: PreventiveMaintenancePlan): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;

  const db = await getDb();
  if (session.user.id !== plan.user_id) {
    await db.runAsync(
      `UPDATE preventive_maintenance_plans SET sync_state = 'error', sync_error = ? WHERE id = ?`,
      ["Plano pertence a outro usuário autenticado", plan.id]
    );
    return;
  }

  const { error } = await supabase.from("preventive_maintenance_plans").upsert(
    {
      id: plan.id,
      user_id: plan.user_id,
      vehicle_id: plan.vehicle_id,
      category: plan.category,
      interval_km: plan.interval_km,
      interval_days: plan.interval_days,
      warning_km: plan.warning_km,
      warning_days: plan.warning_days,
      is_active: plan.is_active,
      created_at: plan.created_at,
      updated_at: plan.updated_at
    },
    { onConflict: "id" }
  );

  if (error) {
    await db.runAsync(
      `UPDATE preventive_maintenance_plans SET sync_state = 'error', sync_error = ? WHERE id = ?`,
      [error.message, plan.id]
    );
    return;
  }

  const { data: confirmRow, error: confirmError } = await supabase
    .from("preventive_maintenance_plans")
    .select("id")
    .eq("id", plan.id)
    .maybeSingle();

  if (confirmError || !confirmRow) {
    await db.runAsync(
      `UPDATE preventive_maintenance_plans SET sync_state = 'error', sync_error = ? WHERE id = ?`,
      [confirmError?.message ?? "Plano não encontrado após sincronização", plan.id]
    );
    return;
  }

  await db.runAsync(
    `UPDATE preventive_maintenance_plans SET sync_state = 'synced', sync_error = NULL WHERE id = ?`,
    [plan.id]
  );
}

export async function getPreventiveMaintenancePlans(
  userId: string,
  vehicleId?: string
): Promise<PreventiveMaintenancePlan[]> {
  const db = await getDb();
  const args: (string | number)[] = [userId];
  const vehicleFilter = vehicleId ? ` AND p.vehicle_id = ?` : "";
  if (vehicleId) args.push(vehicleId);

  const rows = await db.getAllAsync<PreventivePlanRow>(
    `SELECT p.* FROM preventive_maintenance_plans p
     WHERE p.user_id = ?${vehicleFilter}
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.user_id = p.user_id
           AND pd.table_name = 'preventive_maintenance_plans'
           AND pd.record_id = p.id
       )
     ORDER BY p.is_active DESC, p.category ASC`,
    args
  );
  return rows.map(mapPlanRow);
}

export async function getPreventiveMaintenancePlanById(
  userId: string,
  planId: string
): Promise<PreventiveMaintenancePlan | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PreventivePlanRow>(
    `SELECT p.* FROM preventive_maintenance_plans p
     WHERE p.user_id = ? AND p.id = ?
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.user_id = p.user_id
           AND pd.table_name = 'preventive_maintenance_plans'
           AND pd.record_id = p.id
       )
     LIMIT 1`,
    [userId, planId]
  );
  return row ? mapPlanRow(row) : null;
}

export async function getPendingPreventiveMaintenancePlans(
  userId: string
): Promise<PreventiveMaintenancePlan[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PreventivePlanRow>(
    `SELECT p.* FROM preventive_maintenance_plans p
     WHERE p.user_id = ? AND p.sync_state != 'synced'
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.user_id = p.user_id
           AND pd.table_name = 'preventive_maintenance_plans'
           AND pd.record_id = p.id
       )
     ORDER BY p.updated_at ASC`,
    [userId]
  );
  return rows.map(mapPlanRow);
}

export async function getLatestOdometerForVehicle(
  userId: string,
  vehicleId: string
): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ odometer_km: number | null }>(
    `SELECT MAX(value) AS odometer_km FROM (
       SELECT end_odometer_km AS value FROM work_sessions
       WHERE user_id = ? AND vehicle_id = ? AND end_odometer_km IS NOT NULL
       UNION ALL
       SELECT start_odometer_km AS value FROM work_sessions
       WHERE user_id = ? AND vehicle_id = ? AND start_odometer_km IS NOT NULL
       UNION ALL
       SELECT odometer_km AS value FROM maintenance_events
       WHERE user_id = ? AND vehicle_id = ? AND odometer_km IS NOT NULL
     )`,
    [userId, vehicleId, userId, vehicleId, userId, vehicleId]
  );
  return row?.odometer_km ?? null;
}

function eventMatchesCategory(event: MaintenanceEvent, category: string): boolean {
  return event.description === category || event.description.startsWith(`${category} —`);
}

export async function getPreventiveMaintenanceOverviewForVehicle(
  userId: string,
  vehicleId: string,
  now: Date = new Date()
): Promise<PreventiveMaintenanceOverview[]> {
  const [plans, events, currentOdometerKm] = await Promise.all([
    getPreventiveMaintenancePlans(userId, vehicleId),
    getMaintenanceEvents(userId, vehicleId),
    getLatestOdometerForVehicle(userId, vehicleId)
  ]);

  return plans
    .filter((plan) => plan.is_active)
    .map((plan) => {
      const lastEvent = events.find((event) => eventMatchesCategory(event, plan.category)) ?? null;
      const calculated = calculatePreventivePlanStatus({
        intervalKm: plan.interval_km,
        intervalDays: plan.interval_days,
        warningKm: plan.warning_km,
        warningDays: plan.warning_days,
        lastOdometerKm: lastEvent?.odometer_km ?? null,
        currentOdometerKm,
        lastPerformedAt: lastEvent?.performed_at ?? null,
        now
      });

      return {
        plan,
        lastEvent,
        currentOdometerKm,
        remainingKm: calculated.remainingKm,
        remainingDays: calculated.remainingDays,
        status: lastEvent ? calculated.status : "unknown"
      };
    });
}
