jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));
jest.mock("@/services/VehicleService", () => ({
  getDefaultVehicle: jest.fn()
}));
jest.mock("uuid", () => ({ v4: () => "maintenance-test-id" }));

import { getDb } from "@/lib/database";
import {
  addMaintenanceEvent,
  calculatePreventiveMaintenanceStatus,
  getMaintenanceEvents
} from "@/services/MaintenanceService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

function createDbMock() {
  return {
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

describe("calculatePreventiveMaintenanceStatus", () => {
  it("identifica manutenção vencida por quilometragem", () => {
    const result = calculatePreventiveMaintenanceStatus({
      lastOdometerKm: 10_000,
      currentOdometerKm: 20_500,
      intervalKm: 10_000
    });

    expect(result.dueByKm).toBe(true);
    expect(result.remainingKm).toBe(-500);
  });

  it("calcula dias restantes sem marcar vencimento antecipadamente", () => {
    const result = calculatePreventiveMaintenanceStatus({
      lastPerformedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-21T00:00:00.000Z"),
      intervalDays: 30
    });

    expect(result.dueByDate).toBe(false);
    expect(result.remainingDays).toBe(10);
  });

  it("marca manutenção vencida por data", () => {
    const result = calculatePreventiveMaintenanceStatus({
      lastPerformedAt: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-08-21T00:00:00.000Z"),
      intervalDays: 30
    });

    expect(result.dueByDate).toBe(true);
    expect(result.remainingDays).toBeLessThanOrEqual(0);
  });
});

describe("MaintenanceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejeita custo negativo antes de acessar o banco", async () => {
    await expect(
      addMaintenanceEvent({
        userId: "user-1",
        vehicleId: "vehicle-1",
        description: "Troca de óleo",
        costInCents: -1
      })
    ).rejects.toThrow("Custo da manutenção não pode ser negativo");

    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("rejeita odômetro negativo antes de acessar o banco", async () => {
    await expect(
      addMaintenanceEvent({
        userId: "user-1",
        vehicleId: "vehicle-1",
        description: "Pneus",
        costInCents: 1000,
        odometerKm: -1
      })
    ).rejects.toThrow("Odômetro da manutenção não pode ser negativo");

    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("rejeita descrição vazia", async () => {
    await expect(
      addMaintenanceEvent({
        userId: "user-1",
        vehicleId: "vehicle-1",
        description: "   ",
        costInCents: 0
      })
    ).rejects.toThrow("Descrição da manutenção é obrigatória");
  });

  it("filtra histórico simultaneamente por usuário e veículo", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([]);
    mockedGetDb.mockResolvedValue(db as never);

    await getMaintenanceEvents("user-1", "vehicle-1");

    expect(db.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = ? AND vehicle_id = ?"),
      ["user-1", "vehicle-1"]
    );
  });
});
