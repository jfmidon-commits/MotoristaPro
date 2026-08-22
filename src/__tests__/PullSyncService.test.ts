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

const remotePreventivePlan = {
  id: "plan-remote-1",
  user_id: "user-1",
  vehicle_id: "vehicle-1",
  category: "Troca de óleo",
  interval_km: 10_000,
  interval_days: 180,
  warning_km: 1_000,
  warning_days: 15,
  is_active: true,
  created_at: "2026-08-21T12:00:00.000Z",
  updated_at: "2026-08-21T12:00:00.000Z"
};

function configureRemoteRows(params?: { transactions?: any[]; preventivePlans?: any[] }) {
  const rowsByTable: Record<string, any[]> = {
    vehicles: [],
    transactions: params?.transactions ?? [],
    maintenance_events: [],
    work_sessions: [],
    preventive_maintenance_plans: params?.preventivePlans ?? []
  };

  mockedFrom.mockImplementation(((table: string) => ({
    select: jest.fn(() => ({
      eq: jest.fn().mockResolvedValue({ data: rowsByTable[table], error: null })
    }))
  })) as never);
}

function createDbMock(options?: {
  localTransactionState?: string | null;
  localPreventiveState?: string | null;
  tombstoneCount?: number;
  localSyncedTransactions?: Array<{ id: string }>;
  localSyncedPreventive?: Array<{ id: string }>;
}) {
  return {
    getFirstAsync: jest.fn(async (sql: string) => {
      if (sql.includes("pending_deletes")) return { count: options?.tombstoneCount ?? 0 };
      if (sql.includes("FROM preventive_maintenance_plans")) {
        return options?.localPreventiveState ? { sync_state: options.localPreventiveState } : null;
      }
      if (sql.includes("FROM transactions")) {
        return options?.localTransactionState ? { sync_state: options.localTransactionState } : null;
      }
      return null;
    }),
    getAllAsync: jest.fn(async (sql: string) => {
      if (sql.includes("FROM preventive_maintenance_plans")) return options?.localSyncedPreventive ?? [];
      if (sql.includes("FROM transactions")) return options?.localSyncedTransactions ?? [];
      return [];
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

  it("remove cópia local synced quando o registro foi apagado remotamente", async () => {
    configureRemoteRows({ transactions: [] });
    const db = createDbMock({ localSyncedTransactions: [{ id: "tx-deleted-remote" }] });
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.removed).toBe(1);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM transactions"),
      ["tx-deleted-remote", "user-1"]
    );
  });

  it("não remove cópia local com tombstone ainda pendente", async () => {
    configureRemoteRows({ transactions: [] });
    const db = createDbMock({
      localSyncedTransactions: [{ id: "tx-delete-pending" }],
      tombstoneCount: 1
    });
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.removed).toBe(0);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("importa plano preventivo remoto numa instalação nova", async () => {
    configureRemoteRows({ preventivePlans: [remotePreventivePlan] });
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.preventiveMaintenance).toBe(1);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO preventive_maintenance_plans"),
      expect.arrayContaining(["plan-remote-1", "user-1", "vehicle-1", "Troca de óleo", 10_000])
    );
  });

  it("não sobrescreve plano preventivo local pending", async () => {
    configureRemoteRows({ preventivePlans: [remotePreventivePlan] });
    const db = createDbMock({ localPreventiveState: "pending" });
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.preventiveMaintenance).toBe(0);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("não ressuscita plano preventivo com tombstone local", async () => {
    configureRemoteRows({ preventivePlans: [remotePreventivePlan] });
    const db = createDbMock({ tombstoneCount: 1 });
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.preventiveMaintenance).toBe(0);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it("reconcilia deleção remota de plano synced", async () => {
    configureRemoteRows({ preventivePlans: [] });
    const db = createDbMock({ localSyncedPreventive: [{ id: "plan-deleted-remote" }] });
    mockedGetDb.mockResolvedValue(db as never);

    const result = await pullRemoteState("user-1");

    expect(result.removed).toBe(1);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM preventive_maintenance_plans"),
      ["plan-deleted-remote", "user-1"]
    );
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
