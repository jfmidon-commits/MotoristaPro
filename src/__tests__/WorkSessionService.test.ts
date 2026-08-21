jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));
jest.mock("uuid", () => ({ v4: () => "work-session-test-id" }));

import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import {
  startWorkSession,
  endWorkSession,
  getActiveWorkSession
} from "@/services/WorkSessionService";
import type { WorkSession } from "@/types";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSession = supabase.auth.getSession as jest.MockedFunction<
  typeof supabase.auth.getSession
>;

function createDbMock() {
  return {
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn(),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

const activeSession: WorkSession = {
  id: "active-session",
  user_id: "user-1",
  vehicle_id: "vehicle-1",
  started_at: "2026-08-21T10:00:00.000Z",
  ended_at: null,
  start_odometer_km: 1000,
  end_odometer_km: null,
  created_at: "2026-08-21T10:00:00.000Z",
  sync_state: "pending",
  sync_error: null
};

describe("WorkSessionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSession.mockResolvedValue({
      data: { session: null },
      error: null
    } as never);
  });

  it("rejeita um segundo turno quando já existe turno aberto", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(activeSession);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(
      startWorkSession({ userId: "user-1", vehicleId: "vehicle-1", startOdometerKm: 1000 })
    ).rejects.toThrow("Já existe um turno em aberto");

    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("rejeita odômetro inicial negativo", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(null);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(
      startWorkSession({ userId: "user-1", vehicleId: null, startOdometerKm: -1 })
    ).rejects.toThrow("Odômetro inicial não pode ser negativo");

    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("cria turno local como pending mesmo sem rede/sessão remota", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(null);
    mockedGetDb.mockResolvedValue(db as never);

    const result = await startWorkSession({
      userId: "user-1",
      vehicleId: "vehicle-1",
      startOdometerKm: 1234
    });

    expect(result).toMatchObject({
      id: "work-session-test-id",
      user_id: "user-1",
      vehicle_id: "vehicle-1",
      start_odometer_km: 1234,
      ended_at: null,
      sync_state: "pending",
      sync_error: null
    });
    expect(db.runAsync).toHaveBeenCalledTimes(1);
  });

  it("rejeita odômetro final menor que o inicial", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(activeSession);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(
      endWorkSession({ sessionId: activeSession.id, endOdometerKm: 999 })
    ).rejects.toThrow("Odômetro final não pode ser menor que o inicial");

    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("retorna turno ativo do SQLite", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(activeSession);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(getActiveWorkSession("user-1")).resolves.toEqual(activeSession);
  });
});
