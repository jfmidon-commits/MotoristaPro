import { getRideOfferById } from "@/services/RideOfferService";
import { addRideResult, getRideResultByOfferId } from "@/services/RideResultService";
import { addTransaction } from "@/services/TransactionService";
import {
  incomeCategoryForPlatform,
  paymentMethodLabel,
  type RidePaymentMethod
} from "@/services/RideLifecycleLabels";

export type RideLifecycleState = "offer" | "accepted" | "in_progress" | "ended" | "confirmed";
export type { RidePaymentMethod } from "@/services/RideLifecycleLabels";
export { incomeCategoryForPlatform, paymentMethodLabel } from "@/services/RideLifecycleLabels";

export interface CompleteRideParams {
  userId: string;
  rideOfferId: string;
  paymentMethod: RidePaymentMethod;
  finalAmountCents?: number | null;
  actualDistanceKm?: number | null;
  actualDurationMinutes?: number | null;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
}

export interface CompleteRideResult {
  rideResultId: string;
  transactionId: string | null;
  alreadyCompleted: boolean;
}

/**
 * Confirms one completed ride and mirrors it into the financial ledger.
 *
 * Safety rules:
 * - never invents a ride: the captured offer must exist for the authenticated user;
 * - idempotent for ride_results: if that offer was already completed, it does not create another result;
 * - uses the final amount when provided, otherwise falls back to the captured gross offer amount;
 * - does not modify the Uber/99 capture parsers or overlay logic.
 *
 * The lifecycle detector can call this only after it has independently established that a ride ended
 * and the driver explicitly selected Dinheiro, Pix or Aplicativo.
 */
export async function completeRideAndBookIncome(params: CompleteRideParams): Promise<CompleteRideResult> {
  const offer = await getRideOfferById(params.userId, params.rideOfferId);
  if (!offer) throw new Error("Oferta da corrida não encontrada para confirmação.");

  const existing = await getRideResultByOfferId(params.userId, params.rideOfferId);
  if (existing) {
    return { rideResultId: existing.id, transactionId: null, alreadyCompleted: true };
  }

  const offeredGross = offer.offered_amount + offer.additional_pay;
  const finalAmountCents = params.finalAmountCents ?? offeredGross;
  if (!Number.isFinite(finalAmountCents) || finalAmountCents < 0) {
    throw new Error("Valor final da corrida inválido.");
  }

  const rideResult = await addRideResult({
    userId: params.userId,
    rideOfferId: params.rideOfferId,
    vehicleId: offer.vehicle_id,
    finalAmountCents: Math.round(finalAmountCents),
    actualDistanceKm: params.actualDistanceKm ?? offer.total_expected_distance_km,
    actualDurationMinutes: params.actualDurationMinutes ?? offer.total_expected_duration_minutes,
    startedAt: params.startedAt ?? null,
    endedAt: params.endedAt ?? new Date()
  });

  const tx = await addTransaction({
    userId: params.userId,
    vehicleId: offer.vehicle_id,
    type: "income",
    category: incomeCategoryForPlatform(offer.platform),
    amountInCents: rideResult.final_amount,
    description: `${paymentMethodLabel(params.paymentMethod)} • corrida ${offer.platform.toUpperCase()} • oferta ${offer.id}`,
    occurredAt: rideResult.ended_at ? new Date(rideResult.ended_at) : new Date()
  });

  return { rideResultId: rideResult.id, transactionId: tx.id, alreadyCompleted: false };
}
