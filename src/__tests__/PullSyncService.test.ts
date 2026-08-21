jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));

import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { pullRemoteState } from "@/services/PullSyncService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;
const mockedFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

const remoteTransaction = {
  id: "tx-remote-1",
  user_id: "user-1",
  vehicle_id: null,
  type: "income",
  category: "Corrida",
  amount: 2500,
  description: null,
  occurred_at: "2026-08-21T12:00:00.000Z",
  created_at: "2026-08-21T12:00:00.000Z"
};

function configureRemoteRows(params?: { transactions?: any[] }) {
  const rowsByTable: Record<string, any[]> = {
    vehicles: [],
    transactions: params?.transactions ?? [],
    maintenance_events: [],
    work_sessions: []
  };

  mockedFrom.mockImplementation(((table: string) => ({
    select: jest.fn(() => ({
      eq: jest.fn().mockResolvedValue({ data: rowsByTable[table], error: null })
    }))
  })) as never);
}

function createDbMock(options?: { localTransactionState?: string | null; tombstoneCount?: number }) {
  return {
    getFirstAsync: jest.fn(async (sql: string) => {
      if (sql.includes("pending_deletes")) return { count: options?.tombstoneCount ?? 0 };
      if (sql.includes("FROM transactions")) {
        return options?.localTransactionState ? { sync_state: options.localTransactionState } : null;
      }
      return null;
    }),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

describe("PullSyncService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null
    } as never);
  });

  it("importa transação remota em instalação sem registro local", async () => {
    configureRemoteRows({ transactions: [remoteTransaction] });
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.transactions).toBe(1);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO transactions"),
      expect.arrayContaining(["tx-remote-1", "user-1", "Corrida", 2500])
    );
  });

  it("não sobrescreve transação local pending com versão remota", async () => {
    configureRemoteRows({ transactions: [remoteTransaction] });
    const db = createDbMock({ localTransactionState: "pending" });
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.transactions).toBe(0);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("não ressuscita transação remota quando existe tombstone local", async () => {
    configureRemoteRows({ transactions: [remoteTransaction] });
    const db = createDbMock({ tombstoneCount: 1 });
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.transactions).toBe(0);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("recusa pull quando a sessão autenticada pertence a outro usuário", async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-2" } } },
      error: null
    } as never);

    await expect(pullRemoteState("user-1")).rejects.toThrow(
      "Sessão autenticada inválida para sincronização remota"
    );
    expect(mockedFrom).not.toHaveBeenCalled();
  });
});
