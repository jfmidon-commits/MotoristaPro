jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: { from: jest.fn() }
}));

import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { resetOperationalData } from "@/services/AccountDataService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

function createDbMock() {
  return {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

function mockRemoteDeletes(failingTable?: string) {
  mockedFrom.mockImplementation(((table: string) => {
    const eq = jest.fn().mockResolvedValue({
      error: table === failingTable ? { message: "falha remota" } : null
    });
    return { delete: jest.fn(() => ({ eq })) };
  }) as never);
}

describe("AccountDataService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("apaga apenas dados operacionais do usuário, preservando a conta", async () => {
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);
    mockRemoteDeletes();

    await resetOperationalData("user-1");

    expect(mockedFrom.mock.calls.map((call) => call[0])).toEqual([
      "maintenance_events",
      "preventive_maintenance_plans",
      "transactions",
      "work_sessions",
      "vehicles"
    ]);

    expect(db.execAsync).toHaveBeenNthCalledWith(1, "BEGIN TRANSACTION");
    expect(db.execAsync).toHaveBeenLastCalledWith("COMMIT");

    const localDeletes = db.runAsync.mock.calls;
    expect(localDeletes).toHaveLength(6);
    for (const call of localDeletes) {
      expect(String(call[0])).toContain("WHERE user_id = ?");
      expect(call[1]).toEqual(["user-1"]);
    }
  });

  it("não apaga o SQLite se a limpeza remota falhar", async () => {
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);
    mockRemoteDeletes("transactions");

    await expect(resetOperationalData("user-1")).rejects.toThrow(
      "Não foi possível limpar os dados na nuvem (transactions): falha remota"
    );

    expect(mockedGetDb).not.toHaveBeenCalled();
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("faz rollback se a limpeza local falhar", async () => {
    const db = createDbMock();
    db.runAsync.mockRejectedValueOnce(new Error("falha sqlite"));
    mockedGetDb.mockResolvedValue(db as never);
    mockRemoteDeletes();

    await expect(resetOperationalData("user-1")).rejects.toThrow("falha sqlite");
    expect(db.execAsync).toHaveBeenCalledWith("BEGIN TRANSACTION");
    expect(db.execAsync).toHaveBeenCalledWith("ROLLBACK");
  });

  it("rejeita reset sem usuário autenticado", async () => {
    await expect(resetOperationalData("")).rejects.toThrow("Usuário não autenticado");
    expect(mockedFrom).not.toHaveBeenCalled();
    expect(mockedGetDb).not.toHaveBeenCalled();
  });
});
