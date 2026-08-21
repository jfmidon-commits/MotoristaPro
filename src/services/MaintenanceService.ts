import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { getDefaultVehicle } from "@/services/VehicleService";
import type { MaintenanceEvent } from "@/types";

export class NoVehicleError extends Error {
  constructor() {
    super("Nenhum veículo cadastrado. Cadastre um veículo antes de lançar manutenção.");
    this.name = "NoVehicleError";
  }
}

/**
 * addMaintenanceEvent() SEMPRE exige um vehicle_id real (não usa UUID
 * placeholder). Se o usuário não tem veículo cadastrado ainda, lança
 * NoVehicleError pra UI mostrar o fluxo de criação de veículo primeiro.
 */
export async function addMaintenanceEvent(params: {
  userId: string;
  vehicleId?: string;
  description: string;
  costInCents: number;
  odometerKm?: number;
  performedAt?: Date;
}): Promise<MaintenanceEvent> {
  if (params.costInCents < 0) {
    throw new Error("Custo da manutenção não pode ser negativo.");
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
    description: params.description,
    cost: params.costInCents,
    odometer_km: params.odometerKm ?? null,
    performed_at: (params.performedAt ?? new Date()).toISOString(),
    created_at: new Date().toISOString(),
    sync_state: "pending"
  };

  await db.runAsync(
    `INSERT INTO maintenance_events
      (id, user_id, vehicle_id, description, cost, odometer_km, performed_at, created_at, sync_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.user_id,
      event.vehicle_id,
      event.description,
      event.cost,
      event.odometer_km,
      event.performed_at,
      event.created_at,
      event.sync_state
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
    await db.runAsync(`UPDATE maintenance_events SET sync_state = 'error', sync_error = ? WHERE id = ?`, [error.message, event.id]);
    return;
  }

  // SELECT de confirmação (padrão consistente)
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

  await db.runAsync(`UPDATE maintenance_events SET sync_state = 'synced', sync_error = NULL WHERE id = ?`, [event.id]);
}

export async function getMaintenanceEvents(vehicleId: string): Promise<MaintenanceEvent[]> {
  const db = await getDb();
  return db.getAllAsync<MaintenanceEvent>(
    `SELECT * FROM maintenance_events WHERE vehicle_id = ? ORDER BY performed_at DESC`,
    [vehicleId]
  );
}

export async function getPendingMaintenanceEvents(userId: string): Promise<MaintenanceEvent[]> {
  const db = await getDb();
  return db.getAllAsync<MaintenanceEvent>(
    `SELECT * FROM maintenance_events WHERE user_id = ? AND sync_state != 'synced' ORDER BY created_at ASC`,
    [userId]
  );
}
