import { getDb } from "@/lib/database";
import { calculateDerivedMetrics } from "@/services/DerivedMetrics";
import { getWorkSessionsBetween } from "@/services/WorkSessionService";
import type { Transaction } from "@/types";

export interface PeriodMetrics {
  grossIncome: number;
  totalExpense: number;
  netProfit: number;
  totalKm: number;
  totalHours: number;
  perHourCents: number | null;
  perKmCents: number | null;
  costPerKmCents: number | null;
  transactionCount: number;
}

export async function computeMetrics(
  userId: string,
  startIso: string,
  endIso: string
): Promise<PeriodMetrics> {
  const db = await getDb();

  // Mantém as métricas alinhadas com a lista visível: uma transação com
  // tombstone de deleção não entra no resultado enquanto aguarda o delete remoto.
  const transactions = await db.getAllAsync<Transaction>(
    `SELECT t.* FROM transactions t
     WHERE t.user_id = ?
       AND t.occurred_at >= ?
       AND t.occurred_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.user_id = t.user_id
           AND pd.table_name = 'transactions'
           AND pd.record_id = t.id
       )`,
    [userId, startIso, endIso]
  );

  const grossIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);

  const sessions = await getWorkSessionsBetween(userId, startIso, endIso);

  let totalHours = 0;
  let totalKm = 0;
  for (const session of sessions) {
    if (session.ended_at) {
      const hours =
        (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) /
        3_600_000;
      if (hours > 0) totalHours += hours;
    }
    if (session.start_odometer_km != null && session.end_odometer_km != null) {
      const km = session.end_odometer_km - session.start_odometer_km;
      if (km > 0) totalKm += km;
    }
  }

  const derived = calculateDerivedMetrics({
    grossIncome,
    totalExpense,
    totalHours,
    totalKm
  });

  return {
    grossIncome,
    totalExpense,
    ...derived,
    totalKm,
    totalHours,
    transactionCount: transactions.length
  };
}

export function startOfDayIso(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function endOfDayIso(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function startOfWeekIso(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function startOfMonthIso(date: Date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
}
