export interface ProfitEngineInput {
  offeredAmountCents: number;
  totalDistanceKm: number | null;
  totalDurationMinutes: number | null;
  costPerKmCents?: number;
  fixedCostCents?: number;
}

export interface ProfitEstimate {
  grossRevenueCents: number;
  estimatedCostCents: number;
  expectedNetProfitCents: number;
  grossPerKmCents: number | null;
  grossPerHourCents: number | null;
  netPerKmCents: number | null;
  netPerHourCents: number | null;
}

function safeRate(numeratorCents: number, denominator: number | null): number | null {
  if (denominator == null || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round(numeratorCents / denominator);
}

export function estimateRideProfit(input: ProfitEngineInput): ProfitEstimate {
  const grossRevenueCents = Math.max(0, Math.round(input.offeredAmountCents));
  const costPerKmCents = Math.max(0, Math.round(input.costPerKmCents ?? 0));
  const fixedCostCents = Math.max(0, Math.round(input.fixedCostCents ?? 0));
  const distance = input.totalDistanceKm != null && Number.isFinite(input.totalDistanceKm)
    ? Math.max(0, input.totalDistanceKm)
    : null;
  const duration = input.totalDurationMinutes != null && Number.isFinite(input.totalDurationMinutes)
    ? Math.max(0, input.totalDurationMinutes)
    : null;

  const variableCostCents = distance == null ? 0 : Math.round(distance * costPerKmCents);
  const estimatedCostCents = variableCostCents + fixedCostCents;
  const expectedNetProfitCents = grossRevenueCents - estimatedCostCents;

  return {
    grossRevenueCents,
    estimatedCostCents,
    expectedNetProfitCents,
    grossPerKmCents: safeRate(grossRevenueCents, distance),
    grossPerHourCents: safeRate(grossRevenueCents * 60, duration),
    netPerKmCents: safeRate(expectedNetProfitCents, distance),
    netPerHourCents: safeRate(expectedNetProfitCents * 60, duration)
  };
}
