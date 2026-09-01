import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { Transaction, TransactionType, SupabaseErrorShape, PendingDelete } from "@/types";

const MAX_DELETE_ATTEMPTS = 5;

export async function addTransaction(params: {
  userId: string;
  vehicleId: string | null;
  type: TransactionType;
  category: string;
  amountInCents: number;
  description?: string;
  occurredAt?: Date;
}): Promise<Transaction> {
  if (params.amountInCents < 0) {
    throw new Error("Valor da transação não pode ser negativo.");
  }

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

export async function createTransaction(tx: Transaction): Promise<void> {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  const userId = session?.user?.id ?? null;
  if (!userId) {
    await markSyncState(tx.id, "pending", "Sem sessão autenticada no momento do sync");
    return;
  }

  if (tx.user_id !== userId) {
    await markSyncState(tx.id, "error", "Transação pertence a outro usuário autenticado");
    return;
  }

  const payload = {
    id: tx.id,
    user_id: tx.user_id,
    vehicle_id: tx.vehicle_id,
    type: tx.type,
    category: tx.category,
    amount: tx.amount,
    description: tx.description,
    occurred_at: tx.occurred_at,
    created_at: tx.created_at
  };

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
    await markSyncState(
      tx.id,
      "error",
      selectError?.message ?? "Registro não encontrado após insert"
    );
    return;
  }

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

export async function queueDelete(params: {
  userId: string;
  tableName: string;
  recordId: string;
}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO pending_deletes
      (id, user_id, table_name, record_id, created_at, sync_state, sync_error, attempts)
     VALUES (?, ?, ?, ?, ?, 'pending', NULL, 0)
     ON CONFLICT(user_id, table_name, record_id) DO UPDATE SET
       sync_state = 'pending',
       sync_error = NULL,
       attempts = 0`,
    [uuidv4(), params.userId, params.tableName, params.recordId, new Date().toISOString()]
  );
}

export async function processPendingDeletes(
  userId: string,
  opts?: { force?: boolean }
): Promise<void> {
  const db = await getDb();
  const pending = opts?.force
    ? await db.getAllAsync<PendingDelete>(
        `SELECT * FROM pending_deletes WHERE user_id = ? ORDER BY created_at ASC`,
        [userId]
      )
    : await db.getAllAsync<PendingDelete>(
        `SELECT * FROM pending_deletes
         WHERE user_id = ? AND attempts < ?
         ORDER BY created_at ASC`,
        [userId, MAX_DELETE_ATTEMPTS]
      );

  for (const item of pending) {
    let remoteError: string | null = null;

    try {
      let result: { error: any } | null = null;

      switch (item.table_name) {
        case "transactions":
          result = await supabase.from("transactions").delete().eq("id", item.record_id);
          break;
        case "vehicles":
          result = await supabase.from("vehicles").delete().eq("id", item.record_id);
          break;
        case "maintenance_events":
          result = await supabase.from("maintenance_events").delete().eq("id", item.record_id);
          break;
        case "work_sessions":
          result = await supabase.from("work_sessions").delete().eq("id", item.record_id);
          break;
        case "preventive_maintenance_plans":
          result = await supabase.from("preventive_maintenance_plans").delete().eq("id", item.record_id);
          break;
        case "ride_results":
          result = await supabase.from("ride_results").delete().eq("id", item.record_id);
          break;
        case "ride_offers":
          result = await supabase.from("ride_offers").delete().eq("id", item.record_id);
          break;
        default:
          remoteError = "table_name desconhecido";
      }

      if (result?.error) {
        remoteError = result.error.message;
      }
    } catch (err: any) {
      remoteError = err?.message ?? "Erro de rede";
    }

    if (remoteError) {
      await db.runAsync(
        `UPDATE pending_deletes
         SET sync_error = ?, attempts = attempts + 1
         WHERE id = ?`,
        [remoteError, item.id]
      );
      continue;
    }

    switch (item.table_name) {
      case "transactions":
        await db.runAsync(`DELETE FROM transactions WHERE id = ?`, [item.record_id]);
        break;
      case "vehicles":
        await db.runAsync(`DELETE FROM vehicles WHERE id = ?`, [item.record_id]);
        break;
      case "maintenance_events":
        await db.runAsync(`DELETE FROM maintenance_events WHERE id = ?`, [item.record_id]);
        break;
      case "work_sessions":
        await db.runAsync(`DELETE FROM work_sessions WHERE id = ?`, [item.record_id]);
        break;
      case "preventive_maintenance_plans":
        await db.runAsync(`DELETE FROM preventive_maintenance_plans WHERE id = ?`, [item.record_id]);
        break;
      case "ride_results":
        await db.runAsync(`DELETE FROM ride_results WHERE id = ?`, [item.record_id]);
        break;
      case "ride_offers":
        await db.runAsync(`DELETE FROM ride_offers WHERE id = ?`, [item.record_id]);
        break;
    }

    await db.runAsync(`DELETE FROM pending_deletes WHERE id = ?`, [item.id]);
  }
}

export async function isPendingDelete(tableName: string, recordId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM pending_deletes WHERE table_name = ? AND record_id = ?`,
    [tableName, recordId]
  );
  return (row?.count ?? 0) > 0;
}

export async function deleteTransaction(userId: string, id: string): Promise<void> {
  try {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      await queueDelete({ userId, tableName: "transactions", recordId: id });
      return;
    }
  } catch {
    await queueDelete({ userId, tableName: "transactions", recordId: id });
    return;
  }

  const db = await getDb();
  await db.runAsync(`DELETE FROM transactions WHERE id = ?`, [id]);
  await db.runAsync(
    `DELETE FROM pending_deletes
     WHERE user_id = ? AND table_name = 'transactions' AND record_id = ?`,
    [userId, id]
  );
}

export async function getAllTransactions(
  userId: string,
  opts?: { limit?: number; offset?: number }
): Promise<Transaction[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  return db.getAllAsync<Transaction>(
    `SELECT t.* FROM transactions t
     WHERE t.user_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.user_id = t.user_id
           AND pd.table_name = 'transactions'
           AND pd.record_id = t.id
       )
     ORDER BY t.occurred_at DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
}

export async function getPendingTransactions(userId: string): Promise<Transaction[]> {
  const db = await getDb();
  return db.getAllAsync<Transaction>(
    `SELECT t.* FROM transactions t
     WHERE t.user_id = ? AND t.sync_state != 'synced'
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.user_id = t.user_id
           AND pd.table_name = 'transactions'
           AND pd.record_id = t.id
       )
     ORDER BY t.created_at ASC`,
    [userId]
  );
}

export async function getPendingDeletes(userId: string): Promise<PendingDelete[]> {
  const db = await getDb();
  return db.getAllAsync<PendingDelete>(
    `SELECT * FROM pending_deletes WHERE user_id = ? ORDER BY created_at ASC`,
    [userId]
  );
}
