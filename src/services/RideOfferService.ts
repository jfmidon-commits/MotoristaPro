import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { RideOffer } from "@/types";
import type { NormalizedRideOffer } from "@/services/RideOfferNormalizer";
import { estimateRideProfit } from "@/services/ProfitEngine";
import { decideRide, type DecisionThresholds } from "@/services/DecisionEngine";

export interface AddRideOfferParams {
  userId: string;
  vehicleId?: string | null;
  workSessionId?: string | null;
  offer: NormalizedRideOffer;
  costPerKmCents?: number;
  fixedCostCents?: number;
  thresholds: DecisionThresholds;
}

export async function addRideOffer(params: AddRideOfferParams): Promise<RideOffer> {
  const db = await getDb();
  const grossAmountCents = params.offer.offeredAmountCents + params.offer.additionalPayCents;
  const profit = estimateRideProfit({
    offeredAmountCents: grossAmountCents,
    totalDistanceKm: params.offer.totalExpectedDistanceKm,
    totalDurationMinutes: params.offer.totalExpectedDurationMinutes,
    costPerKmCents: params.costPerKmCents,
    fixedCostCents: params.fixedCostCents
  });
  const decision = decideRide(profit, params.thresholds, params.offer.extractionConfidence ?? 1);
  const now = new Date().toISOString();

  const rideOffer: RideOffer = {
    id: uuidv4(),
    user_id: params.userId,
    vehicle_id: params.vehicleId ?? null,
    work_session_id: params.workSessionId ?? null,
    platform: params.offer.platform,
    category: params.offer.category,
    captured_at: params.offer.capturedAtIso,
    offered_amount: params.offer.offeredAmountCents,
    pickup_distance_km: params.offer.pickupDistanceKm,
    pickup_duration_minutes: params.offer.pickupDurationMinutes,
    trip_distance_km: params.offer.tripDistanceKm,
    trip_duration_minutes: params.offer.tripDurationMinutes,
    total_expected_distance_km: params.offer.totalExpectedDistanceKm,
    total_expected_duration_minutes: params.offer.totalExpectedDurationMinutes,
    approximate_origin_zone: params.offer.approximateOriginZone,
    approximate_destination_zone: params.offer.approximateDestinationZone,
    additional_pay: params.offer.additionalPayCents,
    capture_source: params.offer.captureSource,
    extraction_confidence: params.offer.extractionConfidence,
    estimated_cost: profit.estimatedCostCents,
    expected_net_profit: profit.expectedNetProfitCents,
    expected_net_per_km: profit.netPerKmCents,
    expected_net_per_hour: profit.netPerHourCents,
    decision_label: decision.label,
    decision_score: decision.score,
    decision_reasons_positive_json: JSON.stringify(decision.reasonsPositive),
    decision_reasons_negative_json: JSON.stringify(decision.reasonsNegative),
    decision_confidence: decision.confidence,
    created_at: now,
    sync_state: "pending",
    sync_error: null
  };

  await db.runAsync(
    `INSERT INTO ride_offers
      (id, user_id, vehicle_id, work_session_id, platform, category, captured_at, offered_amount,
       pickup_distance_km, pickup_duration_minutes, trip_distance_km, trip_duration_minutes,
       total_expected_distance_km, total_expected_duration_minutes, approximate_origin_zone,
       approximate_destination_zone, additional_pay, capture_source, extraction_confidence,
       estimated_cost, expected_net_profit, expected_net_per_km, expected_net_per_hour,
       decision_label, decision_score, decision_reasons_positive_json,
       decision_reasons_negative_json, decision_confidence, created_at, sync_state, sync_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rideOffer.id, rideOffer.user_id, rideOffer.vehicle_id, rideOffer.work_session_id,
      rideOffer.platform, rideOffer.category, rideOffer.captured_at, rideOffer.offered_amount,
      rideOffer.pickup_distance_km, rideOffer.pickup_duration_minutes, rideOffer.trip_distance_km,
      rideOffer.trip_duration_minutes, rideOffer.total_expected_distance_km,
      rideOffer.total_expected_duration_minutes, rideOffer.approximate_origin_zone,
      rideOffer.approximate_destination_zone, rideOffer.additional_pay, rideOffer.capture_source,
      rideOffer.extraction_confidence, rideOffer.estimated_cost, rideOffer.expected_net_profit,
      rideOffer.expected_net_per_km, rideOffer.expected_net_per_hour, rideOffer.decision_label,
      rideOffer.decision_score, rideOffer.decision_reasons_positive_json,
      rideOffer.decision_reasons_negative_json, rideOffer.decision_confidence,
      rideOffer.created_at, rideOffer.sync_state, rideOffer.sync_error
    ]
  );

  await syncRideOffer(rideOffer);
  return rideOffer;
}

export async function syncRideOffer(rideOffer: RideOffer): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  if (session.user.id !== rideOffer.user_id) {
    await markRideOfferSyncState(rideOffer.id, "error", "Oferta pertence a outro usuário autenticado");
    return;
  }

  const { sync_state: _syncState, sync_error: _syncError, ...payload } = rideOffer;
  const { error } = await supabase.from("ride_offers").upsert(payload, { onConflict: "id" }).select().single();
  if (error) {
    await markRideOfferSyncState(rideOffer.id, "error", error.message);
    return;
  }

  const { data: confirmRow, error: selectError } = await supabase
    .from("ride_offers").select("id").eq("id", rideOffer.id).maybeSingle();
  if (selectError || !confirmRow) {
    await markRideOfferSyncState(
      rideOffer.id,
      "error",
      selectError?.message ?? "Oferta não encontrada após sincronização"
    );
    return;
  }
  await markRideOfferSyncState(rideOffer.id, "synced", null);
}

async function markRideOfferSyncState(id: string, state: RideOffer["sync_state"], error: string | null) {
  const db = await getDb();
  await db.runAsync(`UPDATE ride_offers SET sync_state = ?, sync_error = ? WHERE id = ?`, [state, error, id]);
}

export async function getPendingRideOffers(userId: string): Promise<RideOffer[]> {
  const db = await getDb();
  return db.getAllAsync<RideOffer>(
    `SELECT * FROM ride_offers WHERE user_id = ? AND sync_state != 'synced' ORDER BY created_at ASC`,
    [userId]
  );
}

export async function getRideOfferById(userId: string, id: string): Promise<RideOffer | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RideOffer>(
    `SELECT * FROM ride_offers WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, id]
  );
  return row ?? null;
}
