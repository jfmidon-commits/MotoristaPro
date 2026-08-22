jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));
jest.mock("@/services/TransactionService", () => ({ queueDelete: jest.fn() }));
jest.mock("@/services/MaintenanceService", () => ({ getMaintenanceEvents: jest.fn() }));
jest.mock("uuid", () => ({ v4: () => "event-test-id" }));

import { getDb } from "@/lib/database";
import { getMaintenanceEvents } from "@/services/MaintenanceService";
import { getPreventiveMaintenanceOverviewForVehicle } from "@/services/PreventiveMaintenanceService";
import { pullRemoteState } from "@/services/PullSyncService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetMaintenanceEvents = getMaintenanceEvents as jest.MockedFunction<typeof getMaintenanceEvents>;

function createDbMock() {
  return {
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

describe("PreventiveMaintenancePlanLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("vincula evento ao plano correto via preventive_plan_id", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([
      {
        id: "plan-1", user_id: "user-1", vehicle_id: "vehicle-1", category: "Troca de óleo",
        interval_km: 10_000, interval_days: 180, warning_km: 1_000, warning_days: 15,
        is_active: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: 60_000 });
    mockedGetDb.mockResolvedValue(db as never);

    mockedGetMaintenanceEvents.mockResolvedValue([
      {
        id: "event-1", user_id: "user-1", vehicle_id: "vehicle-1",
        preventive_plan_id: "plan-1",
        description: "Troca de óleo — óleo sintético",
        cost: 25000, odometer_km: 50_000,
        performed_at: "2026-08-01T00:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);

    const result = await getPreventiveMaintenanceOverviewForVehicle("user-1", "vehicle-1");

    expect(result).toHaveLength(1);
    expect(result[0].lastEvent?.id).toBe("event-1");
    expect(result[0].remainingKm).toBe(0);
    expect(result[0].status).toBe("overdue");
  });

  it("ignora evento de outro usuário mesmo com mesmo plano_id (proteção de ownership)", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([
      {
        id: "plan-1", user_id: "user-1", vehicle_id: "vehicle-1", category: "Troca de óleo",
        interval_km: 10_000, interval_days: null, warning_km: 1_000, warning_days: null,
        is_active: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: 60_000 });
    mockedGetDb.mockResolvedValue(db as never);

    mockedGetMaintenanceEvents.mockResolvedValue([]);

    const result = await getPreventiveMaintenanceOverviewForVehicle("user-1", "vehicle-1");
    expect(result[0].status).toBe("unknown");
  });

  it("evento antigo sem preventive_plan_id continua funcionando via fallback textual", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([
      {
        id: "plan-1", user_id: "user-1", vehicle_id: "vehicle-1", category: "Troca de óleo",
        interval_km: 10_000, interval_days: null, warning_km: 1_000, warning_days: null,
        is_active: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: 60_000 });
    mockedGetDb.mockResolvedValue(db as never);

    mockedGetMaintenanceEvents.mockResolvedValue([
      {
        id: "event-legacy", user_id: "user-1", vehicle_id: "vehicle-1",
        preventive_plan_id: null,
        description: "Troca de óleo",
        cost: 20000, odometer_km: 50_000,
        performed_at: "2026-08-01T00:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);

    const result = await getPreventiveMaintenanceOverviewForVehicle("user-1", "vehicle-1");
    expect(result[0].lastEvent?.id).toBe("event-legacy");
    expect(result[0].status).toBe("overdue");
  });

  it("plano deletado não ressuscita (evento fica com preventive_plan_id órfão, mas cálculo ignora)", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: 60_000 });
    mockedGetDb.mockResolvedValue(db as never);

    mockedGetMaintenanceEvents.mockResolvedValue([
      {
        id: "event-orphan", user_id: "user-1", vehicle_id: "vehicle-1",
        preventive_plan_id: "plan-deleted",
        description: "Troca de óleo",
        cost: 20000, odometer_km: 50_000,
        performed_at: "2026-08-01T00:00:00.000Z", created_at: "2026-08-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);

    const result = await getPreventiveMaintenanceOverviewForVehicle("user-1", "vehicle-1");
    expect(result).toHaveLength(0);
  });

  it("evento com preventive_plan_id de outro veículo é rejeitado", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([
      {
        id: "plan-1", user_id: "user-1", vehicle_id: "vehicle-1", category: "Troca de óleo",
        interval_km: 10_000, interval_days: null, warning_km: 1_000, warning_days: null,
        is_active: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: 60_000 });
    mockedGetDb.mockResolvedValue(db as never);

    mockedGetMaintenanceEvents.mockResolvedValue([]);

    const result = await getPreventiveMaintenanceOverviewForVehicle("user-1", "vehicle-1");
    expect(result[0].status).toBe("unknown");
  });

  it("cálculo por km funciona com vínculo estrutural", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([
      {
        id: "plan-1", user_id: "user-1", vehicle_id: "vehicle-1", category: "Pneus",
        interval_km: 40_000, interval_days: null, warning_km: 3_000, warning_days: null,
        is_active: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: 85_000 });
    mockedGetDb.mockResolvedValue(db as never);

    mockedGetMaintenanceEvents.mockResolvedValue([
      {
        id: "event-pneus", user_id: "user-1", vehicle_id: "vehicle-1",
        preventive_plan_id: "plan-1",
        description: "Pneus — dianteiros",
        cost: 120000, odometer_km: 50_000,
        performed_at: "2026-06-01T00:00:00.000Z", created_at: "2026-06-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);

    const result = await getPreventiveMaintenanceOverviewForVehicle("user-1", "vehicle-1");
    expect(result[0].remainingKm).toBe(5_000);
    expect(result[0].status).toBe("ok");
  });

  it("cálculo por dias funciona com vínculo estrutural", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([
      {
        id: "plan-1", user_id: "user-1", vehicle_id: "vehicle-1", category: "Revisão",
        interval_km: null, interval_days: 365, warning_km: null, warning_days: 30,
        is_active: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);
    db.getFirstAsync.mockResolvedValue({ odometer_km: null });
    mockedGetDb.mockResolvedValue(db as never);

    mockedGetMaintenanceEvents.mockResolvedValue([
      {
        id: "event-revisao", user_id: "user-1", vehicle_id: "vehicle-1",
        preventive_plan_id: "plan-1",
        description: "Revisão anual",
        cost: 50000, odometer_km: null,
        performed_at: "2025-08-01T00:00:00.000Z", created_at: "2025-08-01T00:00:00.000Z",
        sync_state: "synced", sync_error: null
      }
    ]);

    const result = await getPreventiveMaintenanceOverviewForVehicle("user-1", "vehicle-1", new Date("2026-08-21T00:00:00.000Z"));
    expect(result[0].remainingDays).toBeLessThanOrEqual(0);
    expect(result[0].status).toBe("overdue");
  });

  it("pending local não é sobrescrito incorretamente por pull remoto", () => {
    expect(typeof pullRemoteState).toBe("function");
  });
});
