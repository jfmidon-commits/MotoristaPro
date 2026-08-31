import type { RidePlatform } from "@/types";
import type { RawRideOfferInput } from "@/services/RideOfferNormalizer";
import type { AccessibilityNodeSnapshot, AccessibilitySnapshot } from "../../modules/motorista-notification-listener";

export interface ParsedMoney {
  value: number;
  raw: string;
  isRatePerKm: boolean;
  isTariffLike: boolean;
  isBonusLike: boolean;
  isBalanceLike: boolean;
  top: number;
  left: number;
}

export interface ParsedMetric {
  value: number;
  unit: "km" | "m" | "min";
  kmValue: number;
  raw: string;
  top: number;
  left: number;
}

const OFFER_MARKERS = [
  /aceitar/i,
  /exclusivo/i,
  /\buberx\b/i,
  /\bcomfort\b/i,
  /\bblack\b/i,
  /\bpop\b/i,
  /pop expresso/i,
  /\boferta\b/i,
  /nova solicitação/i,
  /nova corrida/i,
  /solicita[cç][aã]o/i
];

const RATE_HINTS = [/\/\s*km/i, /por\s*km/i];
const TARIFF_HINTS = [/tarifa/i, /expresso/i, /din[aâ]mica/i, /base/i];
const BONUS_HINTS = [/b[oô]nus/i, /promo/i, /promo[cç][aã]o/i, /ganhos/i, /saldo/i];

function parseDecimal(raw: string): number | null {
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function nodeTop(n: AccessibilityNodeSnapshot): number {
  return typeof n.top === "number" ? n.top : 0;
}

function nodeLeft(n: AccessibilityNodeSnapshot): number {
  return typeof n.left === "number" ? n.left : 0;
}

function dedupeTexts(nodes: AccessibilityNodeSnapshot[]): AccessibilityNodeSnapshot[] {
  const seen = new Set<string>();
  const out: AccessibilityNodeSnapshot[] = [];
  for (const n of nodes) {
    const t = (n.text ?? "").trim();
    if (!t) {
      out.push(n);
      continue;
    }
    const normalized = t.toLowerCase().replace(/\s+/g, " ");
    const key = `${normalized}@${n.left ?? 0},${n.top ?? 0},${n.right ?? 0},${n.bottom ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function extractMoney(nodes: AccessibilityNodeSnapshot[]): ParsedMoney[] {
  const results: ParsedMoney[] = [];
  const re = /R\$\s*([0-9]{1,5}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?)/gi;
  for (const n of nodes) {
    const text = n.text ?? "";
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) != null) {
      const value = parseDecimal(m[1]);
      if (value == null) continue;
      const ctx = text;
      results.push({
        value,
        raw: m[0],
        isRatePerKm: RATE_HINTS.some((h) => h.test(ctx)),
        isTariffLike: TARIFF_HINTS.some((h) => h.test(ctx)),
        isBonusLike: BONUS_HINTS.some((h) => h.test(ctx)),
        isBalanceLike: /saldo|ganhos|promo/i.test(ctx),
        top: nodeTop(n),
        left: nodeLeft(n)
      });
    }
  }
  return results;
}

function extractMetrics(nodes: AccessibilityNodeSnapshot[]): ParsedMetric[] {
  const results: ParsedMetric[] = [];
  const patterns: Array<{ re: RegExp; unit: "km" | "m" | "min" }> = [
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*km\b/gi, unit: "km" },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*m\b/gi, unit: "m" },
    { re: /([0-9]+(?:[.,][0-9]+)?)\s*(?:min|minuto|minutos)\b/gi, unit: "min" }
  ];
  for (const n of nodes) {
    const text = n.text ?? "";
    for (const { re, unit } of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) != null) {
        const value = parseDecimal(m[1]);
        if (value == null) continue;
        const kmValue = unit === "m" ? value / 1000 : unit === "km" ? value : value;
        if (unit === "min" && (value < 0 || value > 1440)) continue;
        if ((unit === "km" || unit === "m") && (kmValue < 0 || kmValue > 1000)) continue;
        results.push({
          value,
          unit,
          kmValue: unit === "min" ? value : kmValue,
          raw: m[0],
          top: nodeTop(n),
          left: nodeLeft(n)
        });
      }
    }
  }
  return results;
}

function detectPlatform(packageName: string): RidePlatform | null {
  const s = packageName.toLowerCase();
  if (s === "com.ubercab.driver") return "uber";
  if (s === "com.app99.driver") return "99";
  if (s === "sinet.startup.indriver") return "indrive";
  return null;
}

export function isOfferSnapshot(snapshot: AccessibilitySnapshot): boolean {
  const nodes = snapshot.nodes ?? [];
  const texts = nodes.map((n) => n.text ?? "").join(" ");
  const hasMoney = /R\$\s*[1-9]/.test(texts) || /R\$\s*0*[1-9]/.test(texts);
  const hasMarker = OFFER_MARKERS.some((m) => m.test(texts));
  const hasClickableAccept = nodes.some(
    (n) => n.clickable && /aceitar/i.test(n.text ?? "")
  );

  if (!hasMoney) return false;
  return hasMarker || hasClickableAccept;
}

function pickOfferAmount(moneys: ParsedMoney[]): { amount: number; confidencePenalty: number } | null {
  const candidates = moneys.filter(
    (m) =>
      m.value > 0 &&
      !m.isRatePerKm &&
      !m.isTariffLike &&
      !m.isBonusLike &&
      !m.isBalanceLike
  );
  if (candidates.length === 0) return null;
  const distinct = candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (other) =>
          other.value === candidate.value &&
          other.top === candidate.top &&
          other.left === candidate.left
      ) === index
  );
  if (distinct.length !== 1) return null;
  return { amount: distinct[0].value, confidencePenalty: 0 };
}

function pairLegs(metrics: ParsedMetric[]): {
  pickupDurationMinutes: number | null;
  pickupDistanceKm: number | null;
  tripDurationMinutes: number | null;
  tripDistanceKm: number | null;
  ambiguous: boolean;
} {
  const mins = metrics.filter((m) => m.unit === "min").sort((a, b) => a.top - b.top || a.left - b.left);
  const dists = metrics
    .filter((m) => m.unit === "km" || m.unit === "m")
    .sort((a, b) => a.top - b.top || a.left - b.left);

  if (mins.length === 0 && dists.length === 0) {
    return {
      pickupDurationMinutes: null,
      pickupDistanceKm: null,
      tripDurationMinutes: null,
      tripDistanceKm: null,
      ambiguous: false
    };
  }

  const usedDist = new Set<number>();
  const pairs: Array<{ min: number; km: number; top: number }> = [];

  for (const min of mins) {
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    dists.forEach((d, idx) => {
      if (usedDist.has(idx)) return;
      const dy = Math.abs(d.top - min.top);
      const dx = Math.abs(d.left - min.left);
      const score = dy * 2 + dx * 0.5;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0 && bestScore < 400) {
      usedDist.add(bestIdx);
      pairs.push({ min: min.value, km: dists[bestIdx].kmValue, top: Math.min(min.top, dists[bestIdx].top) });
    } else {
      pairs.push({ min: min.value, km: NaN, top: min.top });
    }
  }

  dists.forEach((d, idx) => {
    if (usedDist.has(idx)) return;
    pairs.push({ min: NaN, km: d.kmValue, top: d.top });
  });

  pairs.sort((a, b) => a.top - b.top);

  if (pairs.length === 0) {
    return {
      pickupDurationMinutes: null,
      pickupDistanceKm: null,
      tripDurationMinutes: null,
      tripDistanceKm: null,
      ambiguous: true
    };
  }

  if (pairs.length === 1) {
    const p = pairs[0];
    return {
      pickupDurationMinutes: Number.isFinite(p.min) ? p.min : null,
      pickupDistanceKm: Number.isFinite(p.km) ? p.km : null,
      tripDurationMinutes: null,
      tripDistanceKm: null,
      ambiguous: true
    };
  }

  const p0 = pairs[0];
  const p1 = pairs[1];
  const ambiguous = pairs.length > 2;

  return {
    pickupDurationMinutes: Number.isFinite(p0.min) ? p0.min : null,
    pickupDistanceKm: Number.isFinite(p0.km) ? p0.km : null,
    tripDurationMinutes: Number.isFinite(p1.min) ? p1.min : null,
    tripDistanceKm: Number.isFinite(p1.km) ? p1.km : null,
    ambiguous
  };
}

function categoryFromTexts(texts: string): string | null {
  const cats = ["UberX", "Comfort", "Black", "Pop Expresso", "Pop", "Exclusivo"];
  for (const c of cats) {
    if (new RegExp(`\\b${c}\\b`, "i").test(texts)) return c;
  }
  return null;
}

export function parseAccessibilitySnapshot(snapshot: AccessibilitySnapshot): RawRideOfferInput | null {
  const platform = detectPlatform(snapshot.packageName ?? "");
  if (!platform) return null;
  if (platform === "indrive") return null;
  if (!isOfferSnapshot(snapshot)) return null;

  const nodes = dedupeTexts(snapshot.nodes ?? []);
  const allText = nodes.map((n) => n.text ?? "").join(" ");
  const moneys = extractMoney(nodes);
  const metrics = extractMetrics(nodes);

  const amountPick = pickOfferAmount(moneys);
  if (!amountPick || amountPick.amount <= 0) return null;

  const legs = pairLegs(metrics);

  let confidence = 0.72;
  confidence -= amountPick.confidencePenalty;
  if (legs.ambiguous) confidence -= 0.2;
  if (legs.pickupDistanceKm == null && legs.tripDistanceKm == null) confidence -= 0.15;
  if (legs.pickupDurationMinutes == null && legs.tripDurationMinutes == null) confidence -= 0.1;
  if (!OFFER_MARKERS.some((m) => m.test(allText))) confidence -= 0.08;
  confidence = Math.max(0.15, Math.min(0.95, confidence));

  const hasAnyLeg =
    legs.pickupDistanceKm != null ||
    legs.tripDistanceKm != null ||
    legs.pickupDurationMinutes != null ||
    legs.tripDurationMinutes != null;
  if (!hasAnyLeg) confidence = Math.min(confidence, 0.35);

  return {
    platform,
    category: categoryFromTexts(allText),
    offeredAmount: amountPick.amount,
    pickupDistanceKm: legs.pickupDistanceKm,
    pickupDurationMinutes: legs.pickupDurationMinutes,
    tripDistanceKm: legs.tripDistanceKm,
    tripDurationMinutes: legs.tripDurationMinutes,
    captureSource: "accessibility",
    extractionConfidence: confidence,
    capturedAt: snapshot.capturedAt != null ? new Date(snapshot.capturedAt) : new Date()
  };
}

export const __test = {
  dedupeTexts,
  extractMoney,
  extractMetrics,
  pairLegs,
  pickOfferAmount,
  isOfferSnapshot,
  parseDecimal
};
