jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: jest.fn(),
    auth: { getSession: jest.fn() }
  }
}));
jest.mock("uuid", () => ({ v4: () => "delete-test-id" }));

import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import {
  deleteTransaction,
  processPendingDeletes,
  queueDelete
} from "@/services/TransactionService";
import type { PendingDelete } from "@/types";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

function createDbMock() {
  return {
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn()
  };
}

function mockRemoteDelete(error: { message: string } | null) {
  const eq = jest.fn().mockResolvedValue({ error });
  const deleteFn = jest.fn(() => ({ eq }));
  mockedFrom.mockReturnValue({ delete: deleteFn } as never);
  return { deleteFn, eq };
}

const pendingDelete: PendingDelete = {
  id: "pd-1",
  user_id: "user-1",
  table_name: "transactions",
  record_id: "tx-1",
  created_at: "2026-08-21T10:00:00.000Z",
  sync_state: "pending",
  sync_error: null,
  attempts: 0
};

describe("fila de deleção offline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("queueDelete é idempotente via ON CONFLICT", async () => {
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);

    await queueDelete({ userId: "user-1", tableName: "transactions", recordId: "tx-1" });

    const sql = db.runAsync.mock.calls[0][0] as string;
    expect(sql).toContain("ON CONFLICT(user_id, table_name, record_id)");
    expect(sql).toContain("attempts = 0");
  });

  it("falha remota ao deletar cria tombstone e preserva registro local", async () => {
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);
    mockRemoteDelete({ message: "offline" });

    await deleteTransaction("user-1", "tx-1");

    const sqlCalls = db.runAsync.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls.some((sql) => sql.includes("INSERT INTO pending_deletes"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("DELETE FROM transactions"))).toBe(false);
  });

  it("sucesso remoto remove o registro local", async () => {
    const db = createDbMock();
    mockedGetDb.mockResolvedValue(db as never);
    mockRemoteDelete(null);

    await deleteTransaction("user-1", "tx-1");

    const sqlCalls = db.runAsync.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls.some((sql) => sql.includes("DELETE FROM transactions"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("DELETE FROM pending_deletes"))).toBe(true);
  });

  it("falha no retry incrementa attempts e mantém tombstone", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([pendingDelete]);
    mockedGetDb.mockResolvedValue(db as never);
    mockRemoteDelete({ message: "continua offline" });

    await processPendingDeletes("user-1");

    const updateCall = db.runAsync.mock.calls.find((call) =>
      String(call[0]).includes("attempts = attempts + 1")
    );
    expect(updateCall).toBeDefined();
    expect(
      db.runAsync.mock.calls.some((call) => String(call[0]).includes("DELETE FROM pending_deletes"))
    ).toBe(false);
  });

  it("retry bem sucedido remove registro local e tombstone", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([pendingDelete]);
    mockedGetDb.mockResolvedValue(db as never);
    mockRemoteDelete(null);

    await processPendingDeletes("user-1");

    const sqlCalls = db.runAsync.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls.some((sql) => sql.includes("DELETE FROM transactions"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("DELETE FROM pending_deletes"))).toBe(true);
  });

  it("modo force consulta também tombstones que atingiram o limite automático", async () => {
    const db = createDbMock();
    db.getAllAsync.mockResolvedValue([]);
    mockedGetDb.mockResolvedValue(db as never);

    await processPendingDeletes("user-1", { force: true });

    const sql = db.getAllAsync.mock.calls[0][0] as string;
    expect(sql).not.toContain("attempts <");
  });
});
