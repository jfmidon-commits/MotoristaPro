import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { Transaction, TransactionType, SupabaseErrorShape } from "@/types";

/**
 * addTransaction() é a única porta de entrada pra criar uma transação.
 * Fluxo: grava no SQLite primeiro (offline-first) -> tenta sincronizar
 * imediatamente -> se falhar, fica marcada como 'pending' e o
 * useTransactionSync() tenta de novo depois.
 */
export async function addTransaction(params: {
  userId: string;
  vehicleId: string | null;
  type: TransactionType;
  category: string;
  amountInCents: number;
  description?: string;
  occurredAt?: Date;
}): Promise<Transaction> {
  const db = await getDb();

  const tx: Transaction = {
    id: uuidv4(),
    user_id: params.userId,
    vehicle_id: params.vehicleId,
    type: params.type,
    category: params.category,
    amount: params.amountInCents,
    description: params.description ?? null,
    occurred_at: (params.occurredAt ?? new Date()).toISOString(),
    created_at: new Date().toISOString(),
    sync_state: "pending",
    sync_error: null
  };

  console.log("[DEBUG] addTransaction() gravando no SQLite", {
    id: tx.id,
    type: tx.type,
    amount: tx.amount
  });

  await db.runAsync(
    `INSERT INTO transactions
      (id, user_id, vehicle_id, type, category, amount, description, occurred_at, created_at, sync_state, sync_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tx.id,
      tx.user_id,
      tx.vehicle_id,
      tx.type,
      tx.category,
      tx.amount,
      tx.description,
      tx.occurred_at,
      tx.created_at,
      tx.sync_state,
      tx.sync_error
    ]
  );

  await createTransaction(tx);
  return tx;
}

/**
 * createTransaction() é responsável só pela parte de rede: manda a
 * transação pro Supabase e atualiza o sync_state local conforme o resultado.
 * NUNCA apaga nem recria a linha do SQLite.
 */
export async function createTransaction(tx: Transaction): Promise<void> {
  console.log("[SYNC] createTransaction() chamado", { id: tx.id });

  const {
    data: { session }
  } = await supabase.auth.getSession();

  const isAuthenticated = !!session?.user;
  const userId = session?.user?.id ?? null;

  console.log("[SYNC] estado de auth", { isAuthenticated, userId });

  if (!isAuthenticated || !userId) {
    console.log("[SYNC] sem sessão válida — mantendo transação como pending");
    await markSyncState(tx.id, "pending", "Sem sessão autenticada no momento do sync");
    return;
  }

  const payload = {
    id: tx.id,
    user_id: userId,
    vehicle_id: tx.vehicle_id,
    type: tx.type,
    category: tx.category,
    amount: tx.amount,
    description: tx.description,
    occurred_at: tx.occurred_at,
    created_at: tx.created_at
  };

  console.log("[SYNC] payload enviado ao Supabase", payload);

  const { data, error } = await supabase
    .from("transactions")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    const shaped: SupabaseErrorShape = {
      message: error.message,
      code: (error as any).code,
      details: (error as any).details,
      hint: (error as any).hint
    };
    console.log("[SUPABASE] erro no insert", shaped);
    await markSyncState(tx.id, "error", error.message);
    return;
  }

  console.log("[SUPABASE] insert OK", data);

  const { data: confirmRow, error: selectError } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", tx.id)
    .maybeSingle();

  if (selectError || !confirmRow) {
    console.log("[SUPABASE] SELECT de confirmação falhou", selectError);
    await markSyncState(tx.id, "error", selectError?.message ?? "Registro não encontrado após insert");
    return;
  }

  console.log("[SUPABASE] SELECT confirmou registro", confirmRow);
  await markSyncState(tx.id, "synced", null);
}

async function markSyncState(id: string, state: Transaction["sync_state"], error: string | null) {
  const db = await getDb();
  await db.runAsync(`UPDATE transactions SET sync_state = ?, sync_error = ? WHERE id = ?`, [
    state,
    error,
    id
  ]);
}

export async function getAllTransactions(
  userId: string,
  opts?: { limit?: number; offset?: number }
): Promise<Transaction[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const rows = await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDb();

  try {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      console.log("[SUPABASE] erro ao excluir remotamente (removendo local mesmo assim)", error);
    }
  } catch (err) {
    console.log("[SYNC] falha de rede ao excluir remotamente (removendo local mesmo assim)", err);
  }

  await db.runAsync(`DELETE FROM transactions WHERE id = ?`, [id]);
}

export async function getPendingTransactions(userId: string): Promise<Transaction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions WHERE user_id = ? AND sync_state != 'synced' ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}
