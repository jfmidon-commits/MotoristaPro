import { describe, expect, it } from "vitest";
import { calculateOfferEconomics, classifyOffer, dedupeOffers } from "@/services/RideOfferDecision";
import type { NormalizedRideOffer } from "@/services/RideOfferNormalizer";

function offer(overrides: Partial<NormalizedRideOffer> = {}): NormalizedRideOffer {
  return {
    platform: "uber",
    category: "Priority",
    offeredAmountCents: 780,
    pickupDistanceKm: 0.6,
    pickupDurationMinutes: 2,
    tripDistanceKm: 1.9,
    tripDurationMinutes: 7,
    totalExpectedDistanceKm: 2.5,
    totalExpectedDurationMinutes: 9,
    approximateOriginZone: null,
    approximateDestinationZone: null,
    additionalPayCents: 192,
    captureSource: "accessibility",
    extractionConfidence: 0.78,
    capturedAtIso: "2026-09-01T20:12:00.000Z",
    ...overrides
  };
}

describe("RideOfferDecision", () => {
  it("calculates total R$/km and R$/hour from the full pickup+trip totals", () => {
    const metrics = calculateOfferEconomics(offer());
    expect(metrics.reaisPerKm).toBeCloseTo(3.12, 2);
    expect(metrics.reaisPerHour).toBeCloseTo(52, 2);
  });

  it("classifies green/yellow/red only when configurable thresholds exist", () => {
    const thresholds = {
      greenPerKm: 2.0,
      yellowPerKm: 1.5,
      greenPerHour: 45,
      yellowPerHour: 35
    };

    expect(classifyOffer(offer(), thresholds)).toBe("green");
    expect(classifyOffer(offer({ offeredAmountCents: 500 }), thresholds)).toBe("yellow");
    expect(classifyOffer(offer({ offeredAmountCents: 300 }), thresholds)).toBe("red");
    expect(classifyOffer(offer(), null)).toBe("neutral");
  });

  it("collapses repeated OCR/accessibility readings of the same offer within 30s", () => {
    const newest = offer({ capturedAtIso: "2026-09-01T20:12:10.000Z" });
    const repeated = offer({ capturedAtIso: "2026-09-01T20:12:03.000Z" });
    const laterIdentical = offer({ capturedAtIso: "2026-09-01T20:13:00.000Z" });

    const result = dedupeOffers([newest, repeated, laterIdentical]);
    expect(result).toHaveLength(2);
    expect(result[0].capturedAtIso).toBe(newest.capturedAtIso);
    expect(result[1].capturedAtIso).toBe(laterIdentical.capturedAtIso);
  });
});
