import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";

const REMOTE_TABLES = [
  "maintenance_events",
  "preventive_maintenance_plans",
  "transactions",
  "work_sessions",
  "vehicles"
] as const;

/**
 * Apaga os dados operacionais do usuário, preservando a conta de autenticação.
 * Exige conexão porque a nuvem é apagada antes do SQLite; assim um reset local
 * nunca pode ser desfeito por um pull posterior de dados antigos.
 */
export async function resetOperationalData(userId: string): Promise<void> {
  if (!userId) throw new Error("Usuário não autenticado.");

  // Filhos primeiro para respeitar FKs no Supabase.
  for (const table of REMOTE_TABLES) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) {
      throw new Error(`Não foi possível limpar os dados na nuvem (${table}): ${error.message}`);
    }
  }

  const db = await getDb();
  await db.execAsync("BEGIN TRANSACTION");
  try {
    // Filhos primeiro para respeitar FKs locais. Escopo estrito ao usuário atual.
    await db.runAsync("DELETE FROM maintenance_events WHERE user_id = ?", [userId]);
    await db.runAsync("DELETE FROM preventive_maintenance_plans WHERE user_id = ?", [userId]);
    await db.runAsync("DELETE FROM transactions WHERE user_id = ?", [userId]);
    await db.runAsync("DELETE FROM work_sessions WHERE user_id = ?", [userId]);
    await db.runAsync("DELETE FROM pending_deletes WHERE user_id = ?", [userId]);
    await db.runAsync("DELETE FROM vehicles WHERE user_id = ?", [userId]);
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK");
    throw error;
  }
}
