jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));
jest.mock("uuid", () => ({ v4: () => "ride-result-test-id" }));

import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { addRideResult, getRideResultByOfferId } from "@/services/RideResultService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;

function createDbMock() {
  return {
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

describe("RideResultService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);
  });

  it("persiste o realizado localmente mesmo sem sessão remota", async () => {
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);

    const result = await addRideResult({
      userId: "user-1",
      rideOfferId: "offer-1",
      vehicleId: "vehicle-1",
      finalAmountCents: 1000,
      actualDistanceKm: 7,
      actualDurationMinutes: 15,
      costPerKmCents: 50
    });

    expect(result).toMatchObject({
      id: "ride-result-test-id",
      ride_offer_id: "offer-1",
      user_id: "user-1",
      final_amount: 1000,
      actual_distance_km: 7,
      actual_duration_minutes: 15,
      estimated_cost: 350,
      net_profit: 650,
      net_per_km: 93,
      net_per_hour: 2600,
      sync_state: "pending"
    });
    expect(db.runAsync).toHaveBeenCalledTimes(1);
  });

  it("rejeita valores reais negativos", async () => {
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);

    await expect(addRideResult({
      userId: "user-1",
      rideOfferId: "offer-1",
      finalAmountCents: 1000,
      actualDistanceKm: -1
    })).rejects.toThrow("Distância real não pode ser negativa");
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("busca resultado pelo offer limitado ao usuário", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(null);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(getRideResultByOfferId("user-1", "offer-1")).resolves.toBeNull();
    expect(db.getFirstAsync).toHaveBeenCalledWith(expect.stringContaining("user_id = ?"), ["user-1", "offer-1"]);
  });
});
