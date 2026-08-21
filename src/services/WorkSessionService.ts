import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { WorkSession } from "@/types";

export interface StartWorkSessionParams {
  userId: string;
  vehicleId: string | null;
  startOdometerKm?: number;
}

export interface EndWorkSessionParams {
  sessionId: string;
  endOdometerKm?: number;
}

export async function startWorkSession(params: StartWorkSessionParams): Promise<WorkSession> {
  const db = await getDb();
  const active = await getActiveWorkSession(params.userId);
  if (active) throw new Error("Já existe um turno em aberto. Encerre-o antes de iniciar outro.");
  if (params.startOdometerKm !== undefined && params.startOdometerKm < 0) {
    throw new Error("Odômetro inicial não pode ser negativo.");
  }

  const now = new Date().toISOString();
  const session: WorkSession = {
    id: uuidv4(), user_id: params.userId, vehicle_id: params.vehicleId ?? null,
    started_at: now, ended_at: null, start_odometer_km: params.startOdometerKm ?? null,
    end_odometer_km: null, created_at: now, sync_state: "pending", sync_error: null
  };

  await db.runAsync(
    `INSERT INTO work_sessions
      (id, user_id, vehicle_id, started_at, ended_at, start_odometer_km, end_odometer_km, created_at, sync_state, sync_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [session.id, session.user_id, session.vehicle_id, session.started_at, session.ended_at,
      session.start_odometer_km, session.end_odometer_km, session.created_at,
      session.sync_state, session.sync_error]
  );
  await syncWorkSession(session);
  return session;
}

export async function endWorkSession(params: EndWorkSessionParams): Promise<WorkSession> {
  const db = await getDb();
  const row = await db.getFirstAsync<WorkSession>(
    `SELECT * FROM work_sessions WHERE id = ? AND ended_at IS NULL`, [params.sessionId]
  );
  if (!row) throw new Error("Turno não encontrado ou já encerrado.");

  if (params.endOdometerKm !== undefined) {
    if (params.endOdometerKm < 0) throw new Error("Odômetro final não pode ser negativo.");
    if (row.start_odometer_km !== null && params.endOdometerKm < row.start_odometer_km) {
      throw new Error("Odômetro final não pode ser menor que o inicial.");
    }
  }

  const endedAt = new Date().toISOString();
  await db.runAsync(
    `UPDATE work_sessions SET ended_at = ?, end_odometer_km = ?, sync_state = 'pending', sync_error = NULL WHERE id = ?`,
    [endedAt, params.endOdometerKm ?? null, params.sessionId]
  );
  const updated: WorkSession = { ...row, ended_at: endedAt, end_odometer_km: params.endOdometerKm ?? null, sync_state: "pending", sync_error: null };
  await syncWorkSession(updated);
  return updated;
}

export async function getActiveWorkSession(userId: string): Promise<WorkSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<WorkSession>(
    `SELECT * FROM work_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );
  return row ?? null;
}

export async function getWorkSessionById(userId: string, sessionId: string): Promise<WorkSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<WorkSession>(
    `SELECT * FROM work_sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [sessionId, userId]
  );
  return row ?? null;
}

export async function getRecentWorkSessions(userId: string, limit = 30): Promise<WorkSession[]> {
  const db = await getDb();
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  return db.getAllAsync<WorkSession>(
    `SELECT * FROM work_sessions WHERE user_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?`,
    [userId, safeLimit]
  );
}

export async function getWorkSessionsBetween(userId: string, startIso: string, endIso: string): Promise<WorkSession[]> {
  const db = await getDb();
  return db.getAllAsync<WorkSession>(
    `SELECT * FROM work_sessions WHERE user_id = ? AND started_at >= ? AND started_at <= ? ORDER BY started_at ASC`,
    [userId, startIso, endIso]
  );
}

export async function syncWorkSession(session: WorkSession): Promise<void> {
  const { data: { session: authSession } } = await supabase.auth.getSession();
  if (!authSession?.user) return;

  const payload = {
    id: session.id, user_id: authSession.user.id, vehicle_id: session.vehicle_id,
    started_at: session.started_at, ended_at: session.ended_at,
    start_odometer_km: session.start_odometer_km, end_odometer_km: session.end_odometer_km,
    created_at: session.created_at
  };

  const { error } = await supabase.from("work_sessions").upsert(payload, { onConflict: "id" }).select().single();
  if (error) {
    await markWorkSessionSyncState(session.id, "error", error.message);
    return;
  }

  const { data: confirmRow, error: selectError } = await supabase
    .from("work_sessions").select("id").eq("id", session.id).maybeSingle();
  if (selectError || !confirmRow) {
    await markWorkSessionSyncState(session.id, "error", selectError?.message ?? "Registro não encontrado após insert");
    return;
  }
  await markWorkSessionSyncState(session.id, "synced", null);
}

async function markWorkSessionSyncState(id: string, state: WorkSession["sync_state"], error: string | null) {
  const db = await getDb();
  await db.runAsync(`UPDATE work_sessions SET sync_state = ?, sync_error = ? WHERE id = ?`, [state, error, id]);
}

export async function getPendingWorkSessions(userId: string): Promise<WorkSession[]> {
  const db = await getDb();
  return db.getAllAsync<WorkSession>(
    `SELECT * FROM work_sessions WHERE user_id = ? AND sync_state != 'synced' ORDER BY created_at ASC`,
    [userId]
  );
}
