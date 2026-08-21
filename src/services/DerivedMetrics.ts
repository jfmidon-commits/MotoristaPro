export interface DerivedMetrics {
  netProfit: number;
  perHourCents: number | null;
  perKmCents: number | null;
  costPerKmCents: number | null;
}

/** Pura, sem I/O — sem imports de SQLite/uuid, roda em qualquer ambiente de teste. */
export function calculateDerivedMetrics(params: {
  grossIncome: number;
  totalExpense: number;
  totalHours: number;
  totalKm: number;
}): DerivedMetrics {
  const netProfit = params.grossIncome - params.totalExpense;
  return {
    netProfit,
    perHourCents: params.totalHours > 0 ? Math.round(netProfit / params.totalHours) : null,
    perKmCents: params.totalKm > 0 ? Math.round(netProfit / params.totalKm) : null,
    costPerKmCents: params.totalKm > 0 ? Math.round(params.totalExpense / params.totalKm) : null
  };
}
