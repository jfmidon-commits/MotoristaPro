import type { CaptureSource, RidePlatform } from "@/types";

export interface RawRideOfferInput {
  platform: RidePlatform | string;
  category?: string | null;
  offeredAmount: string | number;
  pickupDistanceKm?: string | number | null;
  pickupDurationMinutes?: string | number | null;
  tripDistanceKm?: string | number | null;
  tripDurationMinutes?: string | number | null;
  totalExpectedDistanceKm?: string | number | null;
  totalExpectedDurationMinutes?: string | number | null;
  approximateOriginZone?: string | null;
  approximateDestinationZone?: string | null;
  additionalPay?: string | number | null;
  captureSource?: CaptureSource;
  extractionConfidence?: number | null;
  capturedAt?: Date | string;
}

export interface NormalizedRideOffer {
  platform: RidePlatform;
  category: string | null;
  offeredAmountCents: number;
  pickupDistanceKm: number | null;
  pickupDurationMinutes: number | null;
  tripDistanceKm: number | null;
  tripDurationMinutes: number | null;
  totalExpectedDistanceKm: number | null;
  totalExpectedDurationMinutes: number | null;
  approximateOriginZone: string | null;
  approximateDestinationZone: string | null;
  additionalPayCents: number;
  captureSource: CaptureSource;
  extractionConfidence: number | null;
  capturedAtIso: string;
}

function normalizePlatform(value: string): RidePlatform {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("uber")) return "uber";
  if (normalized === "99" || normalized.includes("99app") || normalized.includes("99 app")) return "99";
  if (normalized.includes("indrive") || normalized.includes("in drive")) return "indrive";
  return "other";
}

function parseLocaleDecimalString(value: string): number | null {
  const stripped = value.replace(/[^\d,.-]/g, "");
  if (!stripped) return null;
  const comma = stripped.lastIndexOf(",");
  const dot = stripped.lastIndexOf(".");
  const decimalIndex = Math.max(comma, dot);

  let normalized = stripped;
  if (decimalIndex >= 0) {
    const integerPart = stripped.slice(0, decimalIndex).replace(/[.,]/g, "");
    const decimalPart = stripped.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalized = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDecimal(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = value
    .toLowerCase()
    .replace(/km|quil[oô]metros?|min(?:utos?)?|h(?:oras?)?/g, "")
    .replace(/\s/g, "");
  return parseLocaleDecimalString(cleaned);
}

function parseMoneyToCents(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const amount = typeof value === "number" ? value : parseLocaleDecimalString(value);
  return amount == null || !Number.isFinite(amount) ? 0 : Math.round(amount * 100);
}

function positiveOrNull(value: number | null): number | null {
  return value != null && value >= 0 ? value : null;
}

function inferTotal(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function capturedAtIso(value: Date | string | undefined): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export function normalizeRideOffer(input: RawRideOfferInput): NormalizedRideOffer {
  const pickupDistanceKm = positiveOrNull(parseDecimal(input.pickupDistanceKm));
  const pickupDurationMinutes = positiveOrNull(parseDecimal(input.pickupDurationMinutes));
  const tripDistanceKm = positiveOrNull(parseDecimal(input.tripDistanceKm));
  const tripDurationMinutes = positiveOrNull(parseDecimal(input.tripDurationMinutes));
  const explicitTotalDistance = positiveOrNull(parseDecimal(input.totalExpectedDistanceKm));
  const explicitTotalDuration = positiveOrNull(parseDecimal(input.totalExpectedDurationMinutes));
  const extractionConfidence = input.extractionConfidence == null
    ? null
    : Math.min(1, Math.max(0, input.extractionConfidence));

  return {
    platform: normalizePlatform(String(input.platform)),
    category: input.category?.trim() || null,
    offeredAmountCents: Math.max(0, parseMoneyToCents(input.offeredAmount)),
    pickupDistanceKm,
    pickupDurationMinutes,
    tripDistanceKm,
    tripDurationMinutes,
    totalExpectedDistanceKm: explicitTotalDistance ?? inferTotal(pickupDistanceKm, tripDistanceKm),
    totalExpectedDurationMinutes: explicitTotalDuration ?? inferTotal(pickupDurationMinutes, tripDurationMinutes),
    approximateOriginZone: input.approximateOriginZone?.trim() || null,
    approximateDestinationZone: input.approximateDestinationZone?.trim() || null,
    additionalPayCents: Math.max(0, parseMoneyToCents(input.additionalPay)),
    captureSource: input.captureSource ?? "manual",
    extractionConfidence,
    capturedAtIso: capturedAtIso(input.capturedAt)
  };
}
