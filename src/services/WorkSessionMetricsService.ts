import { getDb } from "@/lib/database";
import { calculateDerivedMetrics } from "@/services/DerivedMetrics";
import type { Transaction, WorkSession } from "@/types";

export interface WorkSessionMetrics {
  grossIncome: number;
  totalExpense: number;
  netProfit: number;
  durationHours: number;
  totalKm: number | null;
  perHourCents: number | null;
  perKmCents: number | null;
  costPerKmCents: number | null;
  transactionCount: number;
}

export function formatDuration(hours: number): string {
  const totalMinutes = Math.max(0, Math.floor(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${h}h ${String(minutes).padStart(2, "0")}min`;
}

export function calculateWorkSessionMetrics(params: {
  transactions: Pick<Transaction, "type" | "amount">[];
  session: Pick<WorkSession, "started_at" | "ended_at" | "start_odometer_km" | "end_odometer_km">;
  now?: Date;
}): WorkSessionMetrics {
  const grossIncome = params.transactions
    .filter((tx) => tx.type === "income")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpense = params.transactions
    .filter((tx) => tx.type === "expense")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const startMs = new Date(params.session.started_at).getTime();
  const endMs = params.session.ended_at
    ? new Date(params.session.ended_at).getTime()
    : (params.now ?? new Date()).getTime();
  const durationHours = Math.max(0, (endMs - startMs) / 3_600_000);

  const totalKm =
    params.session.start_odometer_km != null && params.session.end_odometer_km != null
      ? Math.max(0, params.session.end_odometer_km - params.session.start_odometer_km)
      : null;

  const derived = calculateDerivedMetrics({
    grossIncome,
    totalExpense,
    totalHours: durationHours,
    totalKm: totalKm ?? 0
  });

  return {
    grossIncome,
    totalExpense,
    netProfit: derived.netProfit,
    durationHours,
    totalKm,
    perHourCents: derived.perHourCents,
    perKmCents: totalKm != null && totalKm > 0 ? derived.perKmCents : null,
    costPerKmCents: totalKm != null && totalKm > 0 ? derived.costPerKmCents : null,
    transactionCount: params.transactions.length
  };
}

export async function computeWorkSessionMetrics(
  userId: string,
  session: WorkSession,
  now: Date = new Date()
): Promise<WorkSessionMetrics> {
  const db = await getDb();
  const endIso = session.ended_at ?? now.toISOString();

  const transactions = await db.getAllAsync<Transaction>(
    `SELECT t.* FROM transactions t
     WHERE t.user_id = ?
       AND t.occurred_at >= ?
       AND t.occurred_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM pending_deletes pd
         WHERE pd.table_name = 'transactions' AND pd.record_id = t.id
       )
     ORDER BY t.occurred_at ASC`,
    [userId, session.started_at, endIso]
  );

  return calculateWorkSessionMetrics({ transactions, session, now });
}
