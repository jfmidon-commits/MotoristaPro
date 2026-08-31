import type { DecisionLabel } from "@/types";
import type { ProfitEstimate } from "@/services/ProfitEngine";

export interface DecisionThresholds {
  minNetPerHourCents: number;
  minNetPerKmCents: number;
  borderlineTolerancePercent?: number;
}

export interface DecisionResult {
  label: DecisionLabel;
  score: number;
  expectedNetPerHourCents: number | null;
  expectedNetPerKmCents: number | null;
  reasonsPositive: string[];
  reasonsNegative: string[];
  confidence: number;
}

function ratio(value: number | null, minimum: number): number | null {
  if (value == null || minimum <= 0) return null;
  return value / minimum;
}

export function decideRide(
  profit: ProfitEstimate,
  thresholds: DecisionThresholds,
  extractionConfidence = 1
): DecisionResult {
  const tolerance = Math.min(50, Math.max(0, thresholds.borderlineTolerancePercent ?? 15)) / 100;
  const hourRatio = ratio(profit.netPerHourCents, thresholds.minNetPerHourCents);
  const kmRatio = ratio(profit.netPerKmCents, thresholds.minNetPerKmCents);
  const availableRatios = [hourRatio, kmRatio].filter((item): item is number => item != null);

  const reasonsPositive: string[] = [];
  const reasonsNegative: string[] = [];

  if (hourRatio != null) {
    if (hourRatio >= 1) reasonsPositive.push("Lucro líquido/hora atende ao piso configurado.");
    else reasonsNegative.push("Lucro líquido/hora está abaixo do piso configurado.");
  } else {
    reasonsNegative.push("Tempo previsto insuficiente para calcular lucro/hora.");
  }

  if (kmRatio != null) {
    if (kmRatio >= 1) reasonsPositive.push("Lucro líquido/km atende ao piso configurado.");
    else reasonsNegative.push("Lucro líquido/km está abaixo do piso configurado.");
  } else {
    reasonsNegative.push("Distância prevista insuficiente para calcular lucro/km.");
  }

  let label: DecisionLabel;
  if (availableRatios.length === 0) {
    label = "borderline";
  } else if (availableRatios.some((item) => item < 1 - tolerance)) {
    label = "bad";
  } else if (availableRatios.length < 2) {
    // Nunca sinalizar verde quando falta uma das duas métricas-mãe.
    label = "borderline";
  } else if (availableRatios.every((item) => item >= 1)) {
    label = "good";
  } else {
    label = "borderline";
  }

  const baseScore = availableRatios.length === 0
    ? 50
    : Math.round((availableRatios.reduce((sum, value) => sum + Math.min(1.25, Math.max(0, value)), 0) / availableRatios.length) * 80);
  const score = Math.min(100, Math.max(0, baseScore));
  const completeness = availableRatios.length / 2;
  const confidence = Math.round(Math.min(1, Math.max(0, extractionConfidence)) * completeness * 100) / 100;

  return {
    label,
    score,
    expectedNetPerHourCents: profit.netPerHourCents,
    expectedNetPerKmCents: profit.netPerKmCents,
    reasonsPositive,
    reasonsNegative,
    confidence
  };
}
