import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { getDefaultVehicle } from "@/services/VehicleService";
import type { MaintenanceEvent } from "@/types";

export const MAINTENANCE_CATEGORIES = [
  "Troca de óleo",
  "Filtro de óleo",
  "Filtro de ar",
  "Filtro de combustível",
  "Pneus",
  "Rodízio de pneus",
  "Freios",
  "Alinhamento",
  "Balanceamento",
  "Revisão",
  "Correia",
  "Fluido de freio",
  "Líquido de arrefecimento",
  "Lavagem/estética",
  "Outros"
] as const;

export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export class NoVehicleError extends Error {
  constructor() {
    super("Nenhum veículo cadastrado. Cadastre um veículo antes de lançar manutenção.");
    this.name = "NoVehicleError";
  }
}

export async function addMaintenanceEvent(params: {
  userId: string;
  vehicleId?: string;
  preventivePlanId?: string | null;
  description: string;
  costInCents: number;
  odometerKm?: number;
  performedAt?: Date;
}): Promise<MaintenanceEvent> {
  if (params.costInCents < 0) {
    throw new Error("Custo da manutenção não pode ser negativo.");
  }
  if (params.odometerKm !== undefined && params.odometerKm < 0) {
    throw new Error("Odômetro da manutenção não pode ser negativo.");
  }

  const description = params.description.trim();
  if (!description) {
    throw new Error("Descrição da manutenção é obrigatória.");
  }

  const db = await getDb();

  let vehicleId = params.vehicleId;
  if (!vehicleId) {
    const defaultVehicle = await getDefaultVehicle(params.userId);
    if (!defaultVehicle) {
      throw new NoVehicleError();
    }
    vehicleId = defaultVehicle.id;
  }

  const event: MaintenanceEvent = {
    id: uuidv4(),
    user_id: params.userId,
    vehicle_id: vehicleId,
    preventive_plan_id: params.preventivePlanId ?? null,
    description,
    cost: params.costInCents,
    odometer_km: params.odometerKm ?? null,
    performed_at: (params.performedAt ?? new Date()).toISOString(),
    created_at: new Date().toISOString(),
    sync_state: "pending",
    sync_error: null
  };

  await db.runAsync(
    `INSERT INTO maintenance_events
      (id, user_id, vehicle_id, preventive_plan_id, description, cost, odometer_km, performed_at, created_at, sync_state, sync_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.user_id,
      event.vehicle_id,
      event.preventive_plan_id,
      event.description,
      event.cost,
      event.odometer_km,
      event.performed_at,
      event.created_at,
      event.sync_state,
      event.sync_error
    ]
  );

  await syncMaintenanceEvent(event);
  return event;
}

export async function syncMaintenanceEvent(event: MaintenanceEvent): Promise<void> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.user) return;

  const { error } = await supabase.from("maintenance_events").upsert(
    {
      id: event.id,
      user_id: session.user.id,
      vehicle_id: event.vehicle_id,
      preventive_plan_id: event.preventive_plan_id,
      description: event.description,
      cost: event.cost,
      odometer_km: event.odometer_km,
      performed_at: event.performed_at,
      created_at: event.created_at
    },
    { onConflict: "id" }
  );

  const db = await getDb();
  if (error) {
    console.log("[SUPABASE] erro ao sincronizar manutenção", error);
    await db.runAsync(`UPDATE maintenance_events SET sync_state = 'error', sync_error = ? WHERE id = ?`, [
      error.message,
      event.id
    ]);
    return;
  }

  const { data: confirmRow, error: selectError } = await supabase
    .from("maintenance_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (selectError || !confirmRow) {
    console.log("[SUPABASE] SELECT de confirmação falhou para manutenção", selectError);
    await db.runAsync(`UPDATE maintenance_events SET sync_state = 'error', sync_error = ? WHERE id = ?`, [
      selectError?.message ?? "Registro não encontrado após insert",
      event.id
    ]);
    return;
  }

  await db.runAsync(`UPDATE maintenance_events SET sync_state = 'synced', sync_error = NULL WHERE id = ?`, [
    event.id
  ]);
}

export async function getMaintenanceEvents(
  userId: string,
  vehicleId: string
): Promise<MaintenanceEvent[]> {
  const db = await getDb();
  return db.getAllAsync<MaintenanceEvent>(
    `SELECT * FROM maintenance_events
     WHERE user_id = ? AND vehicle_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.user_id = ? AND pd.table_name = 'maintenance_events' AND pd.record_id = maintenance_events.id
       )
     ORDER BY performed_at DESC`,
    [userId, vehicleId, userId]
  );
}

export async function getPendingMaintenanceEvents(userId: string): Promise<MaintenanceEvent[]> {
  const db = await getDb();
  return db.getAllAsync<MaintenanceEvent>(
    `SELECT * FROM maintenance_events WHERE user_id = ? AND sync_state != 'synced' ORDER BY created_at ASC`,
    [userId]
  );
}
