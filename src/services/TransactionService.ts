import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import type { Transaction, TransactionType, SupabaseErrorShape, PendingDelete } from "@/types";

const MAX_DELETE_ATTEMPTS = 5;

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

// ============================================================
// DELETE SEGURO COM FILA DE DELEÇÃO
// ============================================================

/**
 * Enfileira uma deleção para processamento assíncrono.
 * O registro local NÃO é removido imediatamente — fica invisível via filtro de tombstone.
 */
export async function queueDelete(params: {
  userId: string;
  tableName: string;
  recordId: string;
}): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO pending_deletes (id, user_id, table_name, record_id, created_at, sync_state, sync_error, attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), params.userId, params.tableName, params.recordId, new Date().toISOString(), "pending", null, 0]
  );
}

/**
 * Processa a fila de deleções pendentes.
 * Só remove localmente após confirmação remota.
 * Retry automático enquanto attempts < MAX_DELETE_ATTEMPTS.
 */
export async function processPendingDeletes(userId: string): Promise<void> {
  const db = await getDb();
  const pending = await db.getAllAsync<PendingDelete>(
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
        default:
          console.warn("[DELETE] table_name desconhecido:", item.table_name);
          remoteError = "table_name desconhecido";
      }

      if (result && result.error) {
        remoteError = result.error.message;
      }
    } catch (err: any) {
      remoteError = err?.message ?? "Erro de rede";
    }

    if (remoteError) {
      // Falha: incrementa attempts, mantém pending (não muda para error permanentemente)
      await db.runAsync(
        `UPDATE pending_deletes SET sync_error = ?, attempts = attempts + 1 WHERE id = ?`,
        [remoteError, item.id]
      );
      console.log("[DELETE] falha remota, retry agendado:", item.record_id, remoteError);
    } else {
      // Sucesso: remove do local e da fila
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
      }
      await db.runAsync(`DELETE FROM pending_deletes WHERE id = ?`, [item.id]);
      console.log("[DELETE] sucesso remoto e local:", item.record_id);
    }
  }
}

/**
 * Verifica se um registro está marcado para deleção (tombstone).
 */
export async function isPendingDelete(tableName: string, recordId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM pending_deletes WHERE table_name = ? AND record_id = ?`,
    [tableName, recordId]
  );
  return (row?.count ?? 0) > 0;
}

/**
 * deleteTransaction: fluxo seguro offline-first.
 * 1. Tenta deletar remoto.
 * 2. Se remoto OK -> deleta local.
 * 3. Se remoto falha (rede/erro) -> enfileira para retry, NÃO deleta local.
 * 4. O registro fica invisível via filtro de tombstone em leituras.
 */
export async function deleteTransaction(userId: string, id: string): Promise<void> {
  try {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      console.log("[DELETE] erro remoto — enfileirando:", error.message);
      await queueDelete({ userId, tableName: "transactions", recordId: id });
      return;
    }
  } catch (err: any) {
    console.log("[DELETE] falha de rede — enfileirando:", err?.message);
    await queueDelete({ userId, tableName: "transactions", recordId: id });
    return;
  }

  // Remoto OK: remove local definitivamente
  const db = await getDb();
  await db.runAsync(`DELETE FROM transactions WHERE id = ?`, [id]);
  // Limpa qualquer pending_delete residual (caso exista de retry anterior)
  await db.runAsync(`DELETE FROM pending_deletes WHERE table_name = 'transactions' AND record_id = ?`, [id]);
}

export async function getAllTransactions(
  userId: string,
  opts?: { limit?: number; offset?: number }
): Promise<Transaction[]> {
  const db = await getDb();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  // Filtra tombstones (registros com pending_delete)
  const rows = await db.getAllAsync<Transaction>(
    `SELECT t.* FROM transactions t
     WHERE t.user_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.table_name = 'transactions' AND pd.record_id = t.id
       )
     ORDER BY t.occurred_at DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

export async function getPendingTransactions(userId: string): Promise<Transaction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Transaction>(
    `SELECT t.* FROM transactions t
     WHERE t.user_id = ? AND t.sync_state != 'synced'
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.table_name = 'transactions' AND pd.record_id = t.id
       )
     ORDER BY t.created_at ASC`,
    [userId]
  );
  return rows;
}

export async function getPendingDeletes(userId: string): Promise<PendingDelete[]> {
  const db = await getDb();
  return db.getAllAsync<PendingDelete>(
    `SELECT * FROM pending_deletes WHERE user_id = ? AND attempts < ? ORDER BY created_at ASC`,
    [userId, MAX_DELETE_ATTEMPTS]
  );
}
