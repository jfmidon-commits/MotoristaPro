import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { Vehicle } from "@/types";

type VehicleRow = Omit<Vehicle, "is_default" | "is_archived"> & {
  is_default: number | boolean;
  is_archived: number | boolean;
};

function mapVehicleRow(row: VehicleRow): Vehicle {
  return {
    ...row,
    is_default: row.is_default === true || row.is_default === 1,
    is_archived: row.is_archived === true || row.is_archived === 1,
    sync_error: row.sync_error ?? null
  };
}

export function normalizeVehiclePlate(value?: string | null): string | null {
  const normalized = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || null;
}

async function assertPlateAvailable(params: {
  userId: string;
  plate: string | null;
  excludeVehicleId?: string;
}) {
  if (!params.plate) return;
  const db = await getDb();
  const args: string[] = [params.userId, params.plate];
  const excludeClause = params.excludeVehicleId ? " AND id != ?" : "";
  if (params.excludeVehicleId) args.push(params.excludeVehicleId);

  const duplicate = await db.getFirstAsync<{ id: string; name: string; is_archived: number | boolean }>(
    `SELECT id, name, is_archived FROM vehicles
     WHERE user_id = ?
       AND UPPER(REPLACE(REPLACE(TRIM(COALESCE(plate, '')), '-', ''), ' ', '')) = ?${excludeClause}
     LIMIT 1`,
    args
  );
  if (duplicate) {
    const archived = duplicate.is_archived === true || duplicate.is_archived === 1;
    throw new Error(
      archived
        ? `A placa ${params.plate} pertence ao veículo arquivado "${duplicate.name}". Restaure esse veículo em vez de cadastrar outro.`
        : `A placa ${params.plate} já está cadastrada no veículo "${duplicate.name}".`
    );
  }
}

export async function createVehicle(params: {
  userId: string;
  name: string;
  plate?: string;
  isDefault?: boolean;
}): Promise<Vehicle> {
  const db = await getDb();
  const name = params.name.trim();
  if (!name) throw new Error("Informe o nome/modelo do veículo.");
  const plate = normalizeVehiclePlate(params.plate);
  await assertPlateAvailable({ userId: params.userId, plate });

  const vehicle: Vehicle = {
    id: uuidv4(),
    user_id: params.userId,
    name,
    plate,
    is_default: params.isDefault ?? false,
    is_archived: false,
    created_at: new Date().toISOString(),
    sync_state: "pending",
    sync_error: null
  };

  if (vehicle.is_default) {
    await db.runAsync(
      `UPDATE vehicles SET is_default = 0, sync_state = 'pending', sync_error = NULL
       WHERE user_id = ? AND is_default = 1`,
      [params.userId]
    );
  }

  await db.runAsync(
    `INSERT INTO vehicles (id, user_id, name, plate, is_default, is_archived, created_at, sync_state, sync_error)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [vehicle.id, vehicle.user_id, vehicle.name, vehicle.plate, vehicle.is_default ? 1 : 0,
      vehicle.created_at, vehicle.sync_state, vehicle.sync_error]
  );

  if (vehicle.is_default) await syncAllVehicles(params.userId);
  else await syncVehicle(vehicle);
  return vehicle;
}

export async function updateVehicle(params: {
  userId: string;
  vehicleId: string;
  name: string;
  plate?: string;
}): Promise<Vehicle> {
  const db = await getDb();
  const current = await getVehicleById(params.userId, params.vehicleId);
  if (!current) throw new Error("Veículo não encontrado.");

  const name = params.name.trim();
  if (!name) throw new Error("Informe o nome/modelo do veículo.");
  const plate = normalizeVehiclePlate(params.plate);
  await assertPlateAvailable({ userId: params.userId, plate, excludeVehicleId: params.vehicleId });

  const updated: Vehicle = { ...current, name, plate, sync_state: "pending", sync_error: null };
  await db.runAsync(
    `UPDATE vehicles SET name = ?, plate = ?, sync_state = 'pending', sync_error = NULL
     WHERE id = ? AND user_id = ?`,
    [updated.name, updated.plate, updated.id, params.userId]
  );
  await syncVehicle(updated);
  return updated;
}

export async function setDefaultVehicle(userId: string, vehicleId: string): Promise<void> {
  const db = await getDb();
  const target = await getVehicleById(userId, vehicleId);
  if (!target) throw new Error("Veículo não encontrado.");
  if (target.is_archived) throw new Error("Restaure o veículo antes de torná-lo padrão.");

  await db.runAsync("BEGIN TRANSACTION");
  try {
    await db.runAsync(
      `UPDATE vehicles SET is_default = 0, sync_state = 'pending', sync_error = NULL
       WHERE user_id = ? AND is_default = 1`,
      [userId]
    );
    await db.runAsync(
      `UPDATE vehicles SET is_default = 1, sync_state = 'pending', sync_error = NULL
       WHERE id = ? AND user_id = ? AND is_archived = 0`,
      [vehicleId, userId]
    );
    await db.runAsync("COMMIT");
  } catch (error) {
    await db.runAsync("ROLLBACK");
    throw error;
  }

  await syncAllVehicles(userId);
}

export async function archiveVehicle(userId: string, vehicleId: string): Promise<void> {
  const db = await getDb();
  const current = await getVehicleById(userId, vehicleId);
  if (!current) throw new Error("Veículo não encontrado.");
  if (current.is_archived) return;

  const activeSession = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM work_sessions
     WHERE user_id = ? AND vehicle_id = ? AND ended_at IS NULL
     LIMIT 1`,
    [userId, vehicleId]
  );
  if (activeSession) {
    throw new Error("Encerre o turno ativo deste veículo antes de arquivá-lo.");
  }

  await db.runAsync(
    `UPDATE vehicles
     SET is_archived = 1, is_default = 0, sync_state = 'pending', sync_error = NULL
     WHERE id = ? AND user_id = ?`,
    [vehicleId, userId]
  );

  if (current.is_default) {
    const replacement = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM vehicles
       WHERE user_id = ? AND id != ? AND is_archived = 0
       ORDER BY created_at ASC LIMIT 1`,
      [userId, vehicleId]
    );
    if (replacement) {
      await db.runAsync(
        `UPDATE vehicles SET is_default = 1, sync_state = 'pending', sync_error = NULL
         WHERE id = ? AND user_id = ?`,
        [replacement.id, userId]
      );
    }
  }

  await syncAllVehicles(userId);
}

export async function restoreVehicle(userId: string, vehicleId: string): Promise<void> {
  const db = await getDb();
  const current = await getVehicleById(userId, vehicleId);
  if (!current) throw new Error("Veículo não encontrado.");
  if (!current.is_archived) return;
  await assertPlateAvailable({ userId, plate: current.plate, excludeVehicleId: current.id });

  await db.runAsync(
    `UPDATE vehicles SET is_archived = 0, sync_state = 'pending', sync_error = NULL
     WHERE id = ? AND user_id = ?`,
    [vehicleId, userId]
  );

  const currentDefault = await getDefaultVehicle(userId);
  if (!currentDefault) {
    await db.runAsync(
      `UPDATE vehicles SET is_default = 1, sync_state = 'pending', sync_error = NULL
       WHERE id = ? AND user_id = ?`,
      [vehicleId, userId]
    );
  }
  await syncAllVehicles(userId);
}

export async function syncVehicle(vehicle: Vehicle): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;

  const { error } = await supabase.from("vehicles").upsert(
    {
      id: vehicle.id,
      user_id: session.user.id,
      name: vehicle.name,
      plate: vehicle.plate,
      is_default: vehicle.is_default,
      is_archived: vehicle.is_archived,
      created_at: vehicle.created_at
    },
    { onConflict: "id" }
  );

  const db = await getDb();
  if (error) {
    await db.runAsync(`UPDATE vehicles SET sync_state = 'error', sync_error = ? WHERE id = ?`, [error.message, vehicle.id]);
    return;
  }

  const { data: confirmRow, error: selectError } = await supabase
    .from("vehicles").select("id").eq("id", vehicle.id).maybeSingle();
  if (selectError || !confirmRow) {
    await db.runAsync(`UPDATE vehicles SET sync_state = 'error', sync_error = ? WHERE id = ?`, [
      selectError?.message ?? "Registro não encontrado após insert", vehicle.id
    ]);
    return;
  }

  await db.runAsync(`UPDATE vehicles SET sync_state = 'synced', sync_error = NULL WHERE id = ?`, [vehicle.id]);
}

export async function getVehicles(
  userId: string,
  opts?: { includeArchived?: boolean }
): Promise<Vehicle[]> {
  const db = await getDb();
  const archivedFilter = opts?.includeArchived ? "" : " AND is_archived = 0";
  const rows = await db.getAllAsync<VehicleRow>(
    `SELECT * FROM vehicles WHERE user_id = ?${archivedFilter} ORDER BY is_default DESC, created_at ASC`,
    [userId]
  );
  return rows.map(mapVehicleRow);
}

export async function getArchivedVehicles(userId: string): Promise<Vehicle[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VehicleRow>(
    `SELECT * FROM vehicles WHERE user_id = ? AND is_archived = 1 ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map(mapVehicleRow);
}

export async function getVehicleById(userId: string, vehicleId: string): Promise<Vehicle | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VehicleRow>(
    `SELECT * FROM vehicles WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, vehicleId]
  );
  return row ? mapVehicleRow(row) : null;
}

export async function getDefaultVehicle(userId: string): Promise<Vehicle | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VehicleRow>(
    `SELECT * FROM vehicles WHERE user_id = ? AND is_default = 1 AND is_archived = 0 LIMIT 1`,
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

async function syncAllVehicles(userId: string): Promise<void> {
  const vehicles = await getVehicles(userId, { includeArchived: true });
  for (const vehicle of vehicles) {
    if (vehicle.sync_state !== "synced") await syncVehicle(vehicle);
  }
}
