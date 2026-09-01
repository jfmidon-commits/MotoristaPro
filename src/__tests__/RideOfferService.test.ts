jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));
jest.mock("uuid", () => ({ v4: () => "ride-offer-test-id" }));

import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { addRideOffer, getRideOfferById } from "@/services/RideOfferService";
import { normalizeRideOffer } from "@/services/RideOfferNormalizer";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;

function createDbMock() {
  return {
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

describe("RideOfferService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);
  });

  it("persiste oferta e decisão localmente mesmo sem sessão remota", async () => {
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);
    const offer = normalizeRideOffer({
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

    const result = await addRideOffer({
      userId: "user-1",
      vehicleId: "vehicle-1",
      workSessionId: "session-1",
      offer,
      costPerKmCents: 60,
      thresholds: { minNetPerHourCents: 3500, minNetPerKmCents: 120 }
    });

    expect(result).toMatchObject({
      id: "ride-offer-test-id",
      user_id: "user-1",
      offered_amount: 4145,
      total_expected_distance_km: 21.3,
      total_expected_duration_minutes: 43,
      decision_label: "good",
      sync_state: "pending"
    });
    expect(db.runAsync).toHaveBeenCalledTimes(1);
  });

  it("busca oferta limitada ao usuário", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(null);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(getRideOfferById("user-1", "offer-1")).resolves.toBeNull();
    expect(db.getFirstAsync).toHaveBeenCalledWith(expect.stringContaining("user_id = ?"), ["user-1", "offer-1"]);
  });
});
