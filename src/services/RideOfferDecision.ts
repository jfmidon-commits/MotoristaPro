import type { NormalizedRideOffer } from "@/services/RideOfferNormalizer";

export type OfferSemaphore = "green" | "yellow" | "red" | "neutral";

export interface OfferDecisionThresholds {
  greenPerKm: number;
  yellowPerKm: number;
  greenPerHour: number;
  yellowPerHour: number;
}

export interface RideOfferEconomics {
  reaisPerKm: number | null;
  reaisPerHour: number | null;
}

export function calculateOfferEconomics(offer: NormalizedRideOffer): RideOfferEconomics {
  const amount = offer.offeredAmountCents / 100;
  const km = offer.totalExpectedDistanceKm;
  const minutes = offer.totalExpectedDurationMinutes;

  return {
    reaisPerKm: km != null && km > 0 ? amount / km : null,
    reaisPerHour: minutes != null && minutes > 0 ? amount / (minutes / 60) : null
  };
}

export function classifyOffer(
  offer: NormalizedRideOffer,
  thresholds?: OfferDecisionThresholds | null
): OfferSemaphore {
  if (!thresholds) return "neutral";

  const { reaisPerKm, reaisPerHour } = calculateOfferEconomics(offer);
  if (reaisPerKm == null || reaisPerHour == null) return "neutral";

  if (reaisPerKm >= thresholds.greenPerKm && reaisPerHour >= thresholds.greenPerHour) {
    return "green";
  }

  if (reaisPerKm < thresholds.yellowPerKm || reaisPerHour < thresholds.yellowPerHour) {
    return "red";
  }

  return "yellow";
}

function offerSignature(offer: NormalizedRideOffer): string {
  const km = offer.totalExpectedDistanceKm == null ? "-" : offer.totalExpectedDistanceKm.toFixed(2);
  const minutes = offer.totalExpectedDurationMinutes == null ? "-" : offer.totalExpectedDurationMinutes.toFixed(1);
  return [
    offer.platform,
    offer.category ?? "-",
    offer.offeredAmountCents,
    km,
    minutes
  ].join("|");
}

/**
 * Accessibility/OCR deliberately samples the same short-lived card several times.
 * Keep the newest reading, but collapse identical offers observed within the window.
 * An identical fare seen later is preserved as a new offer.
 */
export function dedupeOffers(
  offersNewestFirst: NormalizedRideOffer[],
  windowMs = 30_000
): NormalizedRideOffer[] {
  const lastAcceptedBySignature = new Map<string, number>();
  const out: NormalizedRideOffer[] = [];

  for (const offer of offersNewestFirst) {
    const signature = offerSignature(offer);
    const at = Date.parse(offer.capturedAtIso);
    const previousAt = lastAcceptedBySignature.get(signature);

    if (
      previousAt != null &&
      Number.isFinite(at) &&
      Number.isFinite(previousAt) &&
      Math.abs(previousAt - at) <= windowMs
    ) {
      continue;
    }

    out.push(offer);
    if (Number.isFinite(at)) lastAcceptedBySignature.set(signature, at);
  }

  return out;
}
