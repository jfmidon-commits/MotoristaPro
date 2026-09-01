import type { RidePlatform } from "@/types";
import type { RawRideOfferInput } from "@/services/RideOfferNormalizer";
import type { RideNotificationPayload } from "@/services/CaptureAdapter";

function compact(parts: Array<string | null | undefined>): string {
  return Array.from(new Set(parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)))).join(" • ");
}

function buildConsolidatedText(payload: RideNotificationPayload): string {
  return compact([
    ...(payload.textLines ?? []),
    payload.text,
    payload.bigText,
    payload.summaryText,
    payload.infoText,
    payload.bigContentTitle,
    payload.tickerText,
    payload.title,
    payload.subText
  ]);
}

function detectPlatform(payload: RideNotificationPayload): RidePlatform | null {
  const source = `${payload.packageName ?? ""} ${payload.appLabel ?? ""}`.toLowerCase();
  if (source.includes("uber")) return "uber";
  if (source.includes("99") || source.includes("taxis99")) return "99";
  if (source.includes("indrive") || source.includes("indriver") || source.includes("in drive")) return "indrive";
  return null;
}

function parseDecimal(raw: string): number | null {
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function extractAmount(text: string): string | null {
  const match = text.match(/R\$\s*([0-9]{1,4}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?)/i);
  return match ? `R$ ${match[1]}` : null;
}

function extractAmountLoose(text: string): string | null {
  const match = text.match(/(?:R\$|\$)\s*([0-9]{1,4}(?:\.[0-9]{3})*(?:[.,][0-9]{1,2})?)/i);
  if (!match) return null;
  const value = parseDecimal(match[1]);
  if (value == null || value <= 0 || value > 5000) return null;
  const formatted = value.toFixed(2).replace(".", ",");
  return `R$ ${formatted}`;
}

function extractDistances(text: string): number[] {
  const values: number[] = [];
  const regex = /([0-9]+(?:[.,][0-9]+)?)\s*km\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) != null) {
    const value = parseDecimal(match[1]);
    if (value != null && value >= 0 && value <= 1000) values.push(value);
  }
  return values;
}

function extractDurations(text: string): number[] {
  const values: number[] = [];
  const regex = /([0-9]+(?:[.,][0-9]+)?)\s*(?:min|minuto|minutos)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) != null) {
    const value = parseDecimal(match[1]);
    if (value != null && value >= 0 && value <= 1440) values.push(value);
  }
  return values;
}

function parsePostedAt(value: RideNotificationPayload["postedAt"]): Date | string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }
  return value;
}

/**
 * Converte somente fragmentos operacionais já extraídos da notificação em uma oferta bruta.
 * O listener nativo persiste apenas fragmentos sanitizados e sinais booleanos sobre extras.
 * Quando a notificação não traz dados suficientes, retorna null para evitar falsos positivos.
 */
export function parseRideNotification(payload: RideNotificationPayload): RawRideOfferInput | null {
  const platform = detectPlatform(payload);
  if (!platform) return null;

  const text = buildConsolidatedText(payload);
  if (!text) return null;

  const amount = extractAmount(text) ?? extractAmountLoose(text);
  if (!amount) return null;

  const distances = extractDistances(text);
  const durations = extractDurations(text);
  if (distances.length === 0 && durations.length === 0) return null;

  const twoLegDistance = distances.length >= 2;
  const twoLegDuration = durations.length >= 2;

  const pickupDistanceKm = twoLegDistance ? distances[0] : null;
  const tripDistanceKm = twoLegDistance ? distances[1] : null;
  const totalExpectedDistanceKm = twoLegDistance ? null : (distances[0] ?? null);

  const pickupDurationMinutes = twoLegDuration ? durations[0] : null;
  const tripDurationMinutes = twoLegDuration ? durations[1] : null;
  const totalExpectedDurationMinutes = twoLegDuration ? null : (durations[0] ?? null);

  let confidence = 0.55;
  if ((payload.textLines?.length ?? 0) > 0) confidence += 0.05;
  if (distances.length > 0) confidence += 0.15;
  if (durations.length > 0) confidence += 0.15;
  if (twoLegDistance && twoLegDuration) confidence += 0.1;
  confidence = Math.min(0.95, confidence);

  return {
    platform,
    offeredAmount: amount,
    pickupDistanceKm,
    pickupDurationMinutes,
    tripDistanceKm,
    tripDurationMinutes,
    totalExpectedDistanceKm,
    totalExpectedDurationMinutes,
    captureSource: "notification",
    extractionConfidence: confidence,
    capturedAt: parsePostedAt(payload.postedAt)
  };
}
