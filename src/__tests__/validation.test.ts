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
jest.mock("uuid", () => ({ v4: () => "validation-test-id" }));

import { getDb } from "@/lib/database";
import { addTransaction } from "@/services/TransactionService";
import { addMaintenanceEvent } from "@/services/MaintenanceService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

describe("validações de entrada dos services", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("TransactionService rejeita valor negativo antes de acessar SQLite", async () => {
    await expect(
      addTransaction({
        userId: "user-1",
        vehicleId: null,
        type: "income",
        category: "Corrida",
        amountInCents: -1
      })
    ).rejects.toThrow("Valor da transação não pode ser negativo");

    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("MaintenanceService rejeita custo negativo antes de acessar SQLite", async () => {
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

  it("MaintenanceService rejeita odômetro negativo antes de acessar SQLite", async () => {
    await expect(
      addMaintenanceEvent({
        userId: "user-1",
        vehicleId: "vehicle-1",
        description: "Troca de óleo",
        costInCents: 10_000,
        odometerKm: -5
      })
    ).rejects.toThrow("Odômetro da manutenção não pode ser negativo");

    expect(mockedGetDb).not.toHaveBeenCalled();
  });
});
