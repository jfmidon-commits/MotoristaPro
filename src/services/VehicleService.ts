import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { Vehicle } from "@/types";

type VehicleRow = Omit<Vehicle, "is_default"> & {
  is_default: number | boolean;
};

function mapVehicleRow(row: VehicleRow): Vehicle {
  return {
    ...row,
    is_default: row.is_default === true || row.is_default === 1,
    sync_error: row.sync_error ?? null
  };
}

/**
 * createVehicle() é EXCLUSIVO para veículos. Nunca deve ser usado como
 * atalho para gerar um id de veículo "placeholder" pra manutenção.
 */
export async function createVehicle(params: {
  userId: string;
  name: string;
  plate?: string;
  isDefault?: boolean;
}): Promise<Vehicle> {
  const db = await getDb();

  const vehicle: Vehicle = {
    id: uuidv4(),
    user_id: params.userId,
    name: params.name,
    plate: params.plate ?? null,
    is_default: params.isDefault ?? false,
    created_at: new Date().toISOString(),
    sync_state: "pending",
    sync_error: null
  };

  if (vehicle.is_default) {
    await db.runAsync(`UPDATE vehicles SET is_default = 0 WHERE user_id = ?`, [params.userId]);
  }

  await db.runAsync(
    `INSERT INTO vehicles (id, user_id, name, plate, is_default, created_at, sync_state, sync_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      vehicle.id,
      vehicle.user_id,
      vehicle.name,
      vehicle.plate,
      vehicle.is_default ? 1 : 0,
      vehicle.created_at,
      vehicle.sync_state,
      vehicle.sync_error
    ]
  );

  await syncVehicle(vehicle);
  return vehicle;
}

export async function syncVehicle(vehicle: Vehicle): Promise<void> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session?.user) return;

  const { error } = await supabase.from("vehicles").upsert(
    {
      id: vehicle.id,
      user_id: session.user.id,
      name: vehicle.name,
      plate: vehicle.plate,
      is_default: vehicle.is_default,
      created_at: vehicle.created_at
    },
    { onConflict: "id" }
  );

  const db = await getDb();
  if (error) {
    console.log("[SUPABASE] erro ao sincronizar veículo", error);
    await db.runAsync(`UPDATE vehicles SET sync_state = 'error', sync_error = ? WHERE id = ?`, [
      error.message,
      vehicle.id
    ]);
    return;
  }

  const { data: confirmRow, error: selectError } = await supabase
    .from("vehicles")
    .select("id")
    .eq("id", vehicle.id)
    .maybeSingle();

  if (selectError || !confirmRow) {
    console.log("[SUPABASE] SELECT de confirmação falhou para veículo", selectError);
    await db.runAsync(`UPDATE vehicles SET sync_state = 'error', sync_error = ? WHERE id = ?`, [
      selectError?.message ?? "Registro não encontrado após insert",
      vehicle.id
    ]);
    return;
  }

  await db.runAsync(`UPDATE vehicles SET sync_state = 'synced', sync_error = NULL WHERE id = ?`, [
    vehicle.id
  ]);
}

export async function getVehicles(userId: string): Promise<Vehicle[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VehicleRow>(
    `SELECT * FROM vehicles WHERE user_id = ? ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map(mapVehicleRow);
}

export async function getDefaultVehicle(userId: string): Promise<Vehicle | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VehicleRow>(
    `SELECT * FROM vehicles WHERE user_id = ? AND is_default = 1 LIMIT 1`,
    [userId]
  );
  return row ? mapVehicleRow(row) : null;
}

export async function getPendingVehicles(userId: string): Promise<Vehicle[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VehicleRow>(
    `SELECT * FROM vehicles WHERE user_id = ? AND sync_state != 'synced' ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map(mapVehicleRow);
}
