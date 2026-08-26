jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));

import { getDb } from "@/lib/database";
import {
  evaluateOdometerConsistency,
  getLatestKnownOdometerForVehicle
} from "@/services/OdometerService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

describe("OdometerService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("marca leitura menor que o maior odômetro conhecido", () => {
    expect(evaluateOdometerConsistency(30_020, 300_028)).toEqual({
      latestKnownKm: 300_028,
      enteredKm: 30_020,
      isLowerThanKnown: true,
      differenceKm: 270_008
    });
  });

  it("aceita leitura igual ou maior que o histórico", () => {
    expect(evaluateOdometerConsistency(50_010, 50_000).isLowerThanKnown).toBe(false);
    expect(evaluateOdometerConsistency(50_000, 50_000).isLowerThanKnown).toBe(false);
  });

  it("não alerta quando ainda não existe referência", () => {
    expect(evaluateOdometerConsistency(10_000, null)).toEqual({
      latestKnownKm: null,
      enteredKm: 10_000,
      isLowerThanKnown: false,
      differenceKm: 0
    });
  });

  it("obtém maior leitura de turnos e manutenções excluindo tombstones", async () => {
    const db = {
      getFirstAsync: jest.fn().mockResolvedValue({ odometer_km: 123_456 })
    };
    mockedGetDb.mockResolvedValue(db as never);

    await expect(getLatestKnownOdometerForVehicle("user-1", "vehicle-1")).resolves.toBe(123_456);
    expect(db.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("SELECT MAX(value) AS odometer_km"),
      ["user-1", "vehicle-1", "user-1", "user-1", "vehicle-1", "user-1", "user-1", "vehicle-1", "user-1"]
    );
  });
});
