import { getDb } from "@/lib/database";
import type { WorkSession } from "@/types";

/**
 * Retorna turnos iniciados dentro do período informado.
 * Apenas turnos encerrados contribuem para métricas de horas/km.
 */
export async function getWorkSessionsBetween(
  userId: string,
  startIso: string,
  endIso: string
): Promise<WorkSession[]> {
  const db = await getDb();
  return db.getAllAsync<WorkSession>(
    `SELECT * FROM work_sessions
     WHERE user_id = ? AND started_at >= ? AND started_at <= ?
     ORDER BY started_at ASC`,
    [userId, startIso, endIso]
  );
}
