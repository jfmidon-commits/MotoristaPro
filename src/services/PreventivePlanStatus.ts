import type { PreventiveMaintenanceStatusLabel } from "@/types";

export interface PreventivePlanStatusInput {
  intervalKm?: number | null;
  intervalDays?: number | null;
  warningKm?: number | null;
  warningDays?: number | null;
  lastOdometerKm?: number | null;
  currentOdometerKm?: number | null;
  lastPerformedAt?: string | null;
  now?: Date;
}

export interface PreventivePlanStatusResult {
  remainingKm: number | null;
  remainingDays: number | null;
  status: PreventiveMaintenanceStatusLabel;
}

export function calculatePreventivePlanStatus(
  input: PreventivePlanStatusInput
): PreventivePlanStatusResult {
  let remainingKm: number | null = null;
  let remainingDays: number | null = null;

  if (
    input.intervalKm != null &&
    input.intervalKm > 0 &&
    input.lastOdometerKm != null &&
    input.currentOdometerKm != null
  ) {
    remainingKm = input.lastOdometerKm + input.intervalKm - input.currentOdometerKm;
  }

  if (input.intervalDays != null && input.intervalDays > 0 && input.lastPerformedAt) {
    const performedAtMs = new Date(input.lastPerformedAt).getTime();
    if (Number.isFinite(performedAtMs)) {
      const nowMs = (input.now ?? new Date()).getTime();
      const dueAtMs = performedAtMs + input.intervalDays * 86_400_000;
      remainingDays = Math.ceil((dueAtMs - nowMs) / 86_400_000);
    }
  }

  const hasReference = remainingKm != null || remainingDays != null;
  if (!hasReference) {
    return { remainingKm, remainingDays, status: "unknown" };
  }

  if ((remainingKm != null && remainingKm <= 0) || (remainingDays != null && remainingDays <= 0)) {
    return { remainingKm, remainingDays, status: "overdue" };
  }

  const kmSoon =
    remainingKm != null && input.warningKm != null && input.warningKm >= 0 && remainingKm <= input.warningKm;
  const daysSoon =
    remainingDays != null && input.warningDays != null && input.warningDays >= 0 && remainingDays <= input.warningDays;

  return {
    remainingKm,
    remainingDays,
    status: kmSoon || daysSoon ? "soon" : "ok"
  };
}
