import type { RideOffer, RideResult } from "@/types";

export interface ReconciliationThresholds {
  distancePercent?: number;
  durationPercent?: number;
  amountDropPercent?: number;
}

export interface ReconciliationResult {
  distanceDeltaKm: number | null;
  distanceDeltaPercent: number | null;
  durationDeltaMinutes: number | null;
  durationDeltaPercent: number | null;
  amountDeltaCents: number;
  amountDeltaPercent: number | null;
  offeredGrossPerKmCents: number | null;
  actualGrossPerKmCents: number | null;
  isRelevantDivergence: boolean;
  reviewMessage: string | null;
}

type ReconciliationOffer = Pick<
  RideOffer,
  "offered_amount" | "total_expected_distance_km" | "total_expected_duration_minutes"
> & Partial<Pick<RideOffer, "additional_pay">>;

function percentDelta(actual: number | null, expected: number | null): number | null {
  if (actual == null || expected == null || expected <= 0) return null;
  return ((actual - expected) / expected) * 100;
}

function rate(amountCents: number, distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.round(amountCents / distanceKm);
}

export function reconcileRide(
  offer: ReconciliationOffer,
  result: Pick<RideResult, "final_amount" | "actual_distance_km" | "actual_duration_minutes">,
  thresholds: ReconciliationThresholds = {}
): ReconciliationResult {
  const expectedAmountCents = offer.offered_amount + Math.max(0, offer.additional_pay ?? 0);
  const distanceDeltaKm = offer.total_expected_distance_km != null && result.actual_distance_km != null
    ? result.actual_distance_km - offer.total_expected_distance_km
    : null;
  const durationDeltaMinutes = offer.total_expected_duration_minutes != null && result.actual_duration_minutes != null
    ? result.actual_duration_minutes - offer.total_expected_duration_minutes
    : null;
  const amountDeltaCents = result.final_amount - expectedAmountCents;

  const distanceDeltaPercent = percentDelta(result.actual_distance_km, offer.total_expected_distance_km);
  const durationDeltaPercent = percentDelta(result.actual_duration_minutes, offer.total_expected_duration_minutes);
  const amountDeltaPercent = expectedAmountCents > 0 ? (amountDeltaCents / expectedAmountCents) * 100 : null;

  const distanceLimit = thresholds.distancePercent ?? 20;
  const durationLimit = thresholds.durationPercent ?? 20;
  const amountDropLimit = thresholds.amountDropPercent ?? 10;

  const distanceRelevant = distanceDeltaPercent != null && distanceDeltaPercent >= distanceLimit;
  const durationRelevant = durationDeltaPercent != null && durationDeltaPercent >= durationLimit;
  const amountRelevant = amountDeltaPercent != null && amountDeltaPercent <= -amountDropLimit;
  const isRelevantDivergence = distanceRelevant || durationRelevant || amountRelevant;

  return {
    distanceDeltaKm,
    distanceDeltaPercent,
    durationDeltaMinutes,
    durationDeltaPercent,
    amountDeltaCents,
    amountDeltaPercent,
    offeredGrossPerKmCents: rate(expectedAmountCents, offer.total_expected_distance_km),
    actualGrossPerKmCents: rate(result.final_amount, result.actual_distance_km),
    isRelevantDivergence,
    reviewMessage: isRelevantDivergence ? "Vale verificar a opção de revisão desta corrida." : null
  };
}
