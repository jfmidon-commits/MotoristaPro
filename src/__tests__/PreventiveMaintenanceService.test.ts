jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));
jest.mock("@/services/TransactionService", () => ({ queueDelete: jest.fn() }));
jest.mock("@/services/MaintenanceService", () => ({ getMaintenanceEvents: jest.fn() }));
jest.mock("uuid", () => ({ v4: () => "plan-test-id" }));

import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { getMaintenanceEvents } from "@/services/MaintenanceService";
import {
  createPreventiveMaintenancePlan,
  getLatestOdometerForVehicle,
  getPreventiveMaintenanceOverviewForVehicle
} from "@/services/PreventiveMaintenanceService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;
const mockedGetMaintenanceEvents = getMaintenanceEvents as jest.MockedFunction<typeof getMaintenanceEvents>;

function createDbMock() {
  return {
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

const basePlanRow = {
  id: "plan-1",
  user_id: "user-1",
  vehicle_id: "vehicle-1",
  category: "Troca de óleo",
  interval_km: 10_000,
  interval_days: 180,
  warning_km: 1_000,
  warning_days: 15,
  is_active: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  sync_state: "synced",
  sync_error: null
};

describe("PreventiveMaintenanceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);
    mockedGetMaintenanceEvents.mockResolvedValue([]);
  });

  it("rejeita plano sem intervalo", async () => {
    await expect(
      createPreventiveMaintenancePlan({
        userId: "user-1",
        vehicleId: "vehicle-1",
        category: "Troca de óleo"
      })
    ).rejects.toThrow("Informe um intervalo em km ou dias");
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("rejeita intervalKm zero com mensagem correta", async () => {
    await expect(
      createPreventiveMaintenancePlan({
        userId: "user-1",
        vehicleId: "vehicle-1",
        category: "Troca de óleo",
        intervalKm: 0
      })
    ).rejects.toThrow("Intervalo em km deve ser maior que zero");
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("permite warning zero e cria o plano local como pending", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue({ id: "vehicle-1" });
    mockedGetDb.mockResolvedValue(db as never);

    const plan = await createPreventiveMaintenancePlan({
      userId: "user-1",
      vehicleId: "vehicle-1",
      category: "Troca de óleo",
      intervalKm: 10_000,
      warningKm: 0
    });

    expect(plan.warning_km).toBe(0);
    expect(plan.sync_state).toBe("pending");
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO preventive_maintenance_plans"),
      expect.arrayContaining(["plan-test-id", "user-1", "vehicle-1", "Troca de óleo", 10_000, 0])
    );
  });

  it("rejeita veículo que não pertence ao usuário", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(null);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(
      createPreventiveMaintenancePlan({
        userId: "user-1",
        vehicleId: "vehicle-other",
        category: "Pneus",
        intervalKm: 40_000
      })
    ).rejects.toThrow("Veículo não encontrado para este usuário");
  });

  it("obtém o maior odômetro conhecido sem inventar distância", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue({ odometer_km: 78_321 });
    mockedGetDb.mockResolvedValue(db as never);

    await expect(getLatestOdometerForVehicle("user-1", "vehicle-1")).resolves.toBe(78_321);
    expect(db.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("SELECT MAX(value) AS odometer_km"),
      ["user-1", "vehicle-1", "user-1", "vehicle-1", "user-1", "vehicle-1"]
    );
  });

  it("plano sem evento anterior fica sem referência", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([basePlanRow]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: 59_000 });
    mockedGetDb.mockResolvedValue(db as never);
    mockedGetMaintenanceEvents.mockResolvedValue([]);

    const result = await getPreventiveMaintenanceOverviewForVehicle(
      "user-1",
      "vehicle-1",
      new Date("2026-08-21T00:00:00.000Z")
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("unknown");
    expect(result[0].lastEvent).toBeNull();
  });

  it("usa a última manutenção da mesma categoria para calcular o alerta", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([basePlanRow]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: 59_000 });
    mockedGetDb.mockResolvedValue(db as never);
    mockedGetMaintenanceEvents.mockResolvedValue([
      {
        id: "event-1",
        user_id: "user-1",
        vehicle_id: "vehicle-1",
        description: "Troca de óleo — óleo sintético",
        cost: 25000,
        odometer_km: 50_000,
        performed_at: "2026-08-01T00:00:00.000Z",
        created_at: "2026-08-01T00:00:00.000Z",
        sync_state: "synced",
        sync_error: null
      }
    ]);

    const result = await getPreventiveMaintenanceOverviewForVehicle(
      "user-1",
      "vehicle-1",
      new Date("2026-08-21T00:00:00.000Z")
    );

    expect(result[0].remainingKm).toBe(1_000);
    expect(result[0].status).toBe("soon");
  });
});
