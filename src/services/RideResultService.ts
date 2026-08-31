import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { RideResult } from "@/types";
import { estimateRideProfit } from "@/services/ProfitEngine";

export interface AddRideResultParams {
  userId: string;
  rideOfferId: string;
  vehicleId?: string | null;
  finalAmountCents: number;
  actualDistanceKm?: number | null;
  actualDurationMinutes?: number | null;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
  costPerKmCents?: number;
  fixedCostCents?: number;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function addRideResult(params: AddRideResultParams): Promise<RideResult> {
  if (params.finalAmountCents < 0) throw new Error("Valor final da corrida não pode ser negativo.");
  if (params.actualDistanceKm != null && params.actualDistanceKm < 0) {
    throw new Error("Distância real não pode ser negativa.");
  }
  if (params.actualDurationMinutes != null && params.actualDurationMinutes < 0) {
    throw new Error("Duração real não pode ser negativa.");
  }

  const db = await getDb();
  const profit = estimateRideProfit({
    offeredAmountCents: params.finalAmountCents,
    totalDistanceKm: params.actualDistanceKm ?? null,
    totalDurationMinutes: params.actualDurationMinutes ?? null,
    costPerKmCents: params.costPerKmCents,
    fixedCostCents: params.fixedCostCents
  });
  const now = new Date().toISOString();
  const rideResult: RideResult = {
    id: uuidv4(),
    ride_offer_id: params.rideOfferId,
    user_id: params.userId,
    vehicle_id: params.vehicleId ?? null,
    final_amount: Math.round(params.finalAmountCents),
    actual_distance_km: params.actualDistanceKm ?? null,
    actual_duration_minutes: params.actualDurationMinutes ?? null,
    started_at: toIso(params.startedAt),
    ended_at: toIso(params.endedAt),
    estimated_cost: profit.estimatedCostCents,
    net_profit: profit.expectedNetProfitCents,
    net_per_km: profit.netPerKmCents,
    net_per_hour: profit.netPerHourCents,
    created_at: now,
    sync_state: "pending",
    sync_error: null
  };

  await db.runAsync(
    `INSERT INTO ride_results
      (id, ride_offer_id, user_id, vehicle_id, final_amount, actual_distance_km,
       actual_duration_minutes, started_at, ended_at, estimated_cost, net_profit,
       net_per_km, net_per_hour, created_at, sync_state, sync_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rideResult.id, rideResult.ride_offer_id, rideResult.user_id, rideResult.vehicle_id,
      rideResult.final_amount, rideResult.actual_distance_km, rideResult.actual_duration_minutes,
      rideResult.started_at, rideResult.ended_at, rideResult.estimated_cost, rideResult.net_profit,
      rideResult.net_per_km, rideResult.net_per_hour, rideResult.created_at,
      rideResult.sync_state, rideResult.sync_error
    ]
  );

  await syncRideResult(rideResult);
  return rideResult;
}

export async function syncRideResult(rideResult: RideResult): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  if (session.user.id !== rideResult.user_id) {
    await markRideResultSyncState(rideResult.id, "error", "Resultado pertence a outro usuário autenticado");
    return;
  }

  const { sync_state: _syncState, sync_error: _syncError, ...payload } = rideResult;
  const { error } = await supabase.from("ride_results").upsert(payload, { onConflict: "id" }).select().single();
  if (error) {
    await markRideResultSyncState(rideResult.id, "error", error.message);
    return;
  }

  const { data: confirmRow, error: selectError } = await supabase
    .from("ride_results").select("id").eq("id", rideResult.id).maybeSingle();
  if (selectError || !confirmRow) {
    await markRideResultSyncState(
      rideResult.id,
      "error",
      selectError?.message ?? "Resultado não encontrado após sincronização"
    );
    return;
  }
  await markRideResultSyncState(rideResult.id, "synced", null);
}

async function markRideResultSyncState(id: string, state: RideResult["sync_state"], error: string | null) {
  const db = await getDb();
  await db.runAsync(`UPDATE ride_results SET sync_state = ?, sync_error = ? WHERE id = ?`, [state, error, id]);
}

export async function getPendingRideResults(userId: string): Promise<RideResult[]> {
  const db = await getDb();
  return db.getAllAsync<RideResult>(
    `SELECT * FROM ride_results WHERE user_id = ? AND sync_state != 'synced' ORDER BY created_at ASC`,
    [userId]
  );
}

export async function getRideResultByOfferId(userId: string, rideOfferId: string): Promise<RideResult | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RideResult>(
    `SELECT * FROM ride_results WHERE user_id = ? AND ride_offer_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId, rideOfferId]
  );
  return row ?? null;
}
