import { normalizeRideOffer } from "@/services/RideOfferNormalizer";

describe("RideOfferNormalizer", () => {
  it("normaliza a fixture Uber Business Comfort sem PII", () => {
    const result = normalizeRideOffer({
      platform: "Uber",
      category: "Business Comfort",
      offeredAmount: "R$ 41,45",
      pickupDistanceKm: "3,9 km",
      pickupDurationMinutes: "8 min",
      tripDistanceKm: "17,4 km",
      tripDurationMinutes: "35 min",
      captureSource: "fixture",
      extractionConfidence: 0.98,
      capturedAt: "2026-08-31T09:00:00.000Z"
    });

    expect(result.platform).toBe("uber");
    expect(result.category).toBe("Business Comfort");
    expect(result.offeredAmountCents).toBe(4145);
    expect(result.pickupDistanceKm).toBeCloseTo(3.9);
    expect(result.tripDistanceKm).toBeCloseTo(17.4);
    expect(result.totalExpectedDistanceKm).toBeCloseTo(21.3);
    expect(result.totalExpectedDurationMinutes).toBe(43);
    expect(result.approximateOriginZone).toBeNull();
    expect(result.approximateDestinationZone).toBeNull();
  });

  it("trata números monetários como reais, não como centavos", () => {
    const result = normalizeRideOffer({
      platform: "99",
      offeredAmount: 18.4,
      tripDistanceKm: 7.2,
      tripDurationMinutes: 14
    });
    expect(result.offeredAmountCents).toBe(1840);
  });

  it("aceita vírgula decimal em km e minutos", () => {
    const result = normalizeRideOffer({
      platform: "inDrive",
      offeredAmount: "R$ 10,00",
      pickupDistanceKm: "1,5 km",
      tripDistanceKm: "5,5 km",
      pickupDurationMinutes: "4 min",
      tripDurationMinutes: "11 min"
    });
    expect(result.totalExpectedDistanceKm).toBe(7);
    expect(result.totalExpectedDurationMinutes).toBe(15);
  });
});
