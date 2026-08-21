import { getDb } from "@/lib/database";
import { getWorkSessionsBetween } from "@/services/WorkSessionService";
import type { Transaction } from "@/types";

export interface PeriodMetrics {
  grossIncome: number; // centavos
  totalExpense: number; // centavos
  netProfit: number; // centavos
  totalKm: number;
  totalHours: number;
  perHourCents: number | null; // lucro líquido / hora
  perKmCents: number | null; // lucro líquido / km
  costPerKmCents: number | null; // despesa / km (quanto custa rodar 1km)
  transactionCount: number;
}

/**
 * Calcula métricas de um período com base nas transações (receita/despesa)
 * e nos turnos de trabalho encerrados (horas + km rodados via odômetro).
 *
 * Km e horas só existem se o usuário efetivamente usar "Iniciar/Encerrar turno"
 * com leitura de odômetro — sem isso, perHourCents/perKmCents ficam null
 * (mostramos isso na UI em vez de fingir uma métrica falsa).
 */
export async function computeMetrics(
  userId: string,
  startIso: string,
  endIso: string
): Promise<PeriodMetrics> {
  const db = await getDb();

  const transactions = await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions WHERE user_id = ? AND occurred_at >= ? AND occurred_at <= ?`,
    [userId, startIso, endIso]
  );

  const grossIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);
  const netProfit = grossIncome - totalExpense;

  const sessions = await getWorkSessionsBetween(userId, startIso, endIso);

  let totalHours = 0;
  let totalKm = 0;
  for (const s of sessions) {
    if (s.ended_at) {
      const hours = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000;
      if (hours > 0) totalHours += hours;
    }
    if (s.start_odometer_km != null && s.end_odometer_km != null) {
      const km = s.end_odometer_km - s.start_odometer_km;
      if (km > 0) totalKm += km;
    }
  }

  return {
    grossIncome,
    totalExpense,
    netProfit,
    totalKm,
    totalHours,
    perHourCents: totalHours > 0 ? Math.round(netProfit / totalHours) : null,
    perKmCents: totalKm > 0 ? Math.round(netProfit / totalKm) : null,
    costPerKmCents: totalKm > 0 ? Math.round(totalExpense / totalKm) : null,
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
  const day = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function startOfMonthIso(date: Date = new Date()): string {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return d.toISOString();
}
