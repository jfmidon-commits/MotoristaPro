import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearPendingRideLifecycleEvents,
  getPendingAccessibilitySnapshots,
  getPendingRideLifecycleEvents,
  type AccessibilitySnapshot,
  type RideLifecycleNativeEvent
} from "../../modules/motorista-notification-listener";
import { parseAccessibilitySnapshot } from "@/services/AccessibilityOfferParser";
import { normalizeRideOffer } from "@/services/RideOfferNormalizer";
import { addRideOffer } from "@/services/RideOfferService";
import { completeRideAndBookIncome, type RidePaymentMethod } from "@/services/RideLifecycleService";
import { getActiveWorkSession } from "@/services/WorkSessionService";

const PROCESSED_KEY = "motoristaPro.processedRideLifecyclePayments.v1";
const MAX_MATCH_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_THRESHOLDS = {
  minNetPerHourCents: 3500,
  minNetPerKmCents: 170,
  borderlineTolerancePercent: 15
};

function eventKey(event: RideLifecycleNativeEvent): string {
  return `${event.platform}|${event.detectedAt}|${event.paymentMethod ?? "-"}`;
}

async function readProcessed(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(PROCESSED_KEY);
    const values = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(values) ? values.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeProcessed(processed: Set<string>) {
  const values = Array.from(processed).slice(-120);
  await AsyncStorage.setItem(PROCESSED_KEY, JSON.stringify(values));
}

function packageForPlatform(platform: RideLifecycleNativeEvent["platform"]): string {
  return platform === "99" ? "com.app99.driver" : "com.ubercab.driver";
}

function paymentMethod(event: RideLifecycleNativeEvent): RidePaymentMethod | null {
  if (event.paymentMethod === "cash" || event.paymentMethod === "pix" || event.paymentMethod === "app") {
    return event.paymentMethod;
  }
  return null;
}

function parseLocaleNumber(value: string): number | null {
  const cleaned = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function recover99Summary(snapshot: AccessibilitySnapshot) {
  if ((snapshot.packageName ?? "").toLowerCase() !== "com.app99.driver") return null;
  if (!(snapshot.fingerprint ?? "").startsWith("screenshotOcr99:")) return null;

  const text = (snapshot.nodes ?? []).map((node) => node.text ?? "").join(" ");
  const match = text.match(
    /99\s*•\s*R\$\s*([0-9.,]+)\s*•\s*TOTAL\s*([0-9.,]+)\s*km\s*•\s*([0-9]+)\s*min/i
  );
  if (!match) return null;

  const fare = parseLocaleNumber(match[1]);
  const totalKm = parseLocaleNumber(match[2]);
  const totalMinutes = Number.parseInt(match[3], 10);
  if (!fare || !totalKm || !Number.isFinite(totalMinutes) || fare <= 0 || totalKm <= 0 || totalMinutes <= 0) {
    return null;
  }

  try {
    return normalizeRideOffer({
      platform: "99",
      offeredAmount: fare,
      totalExpectedDistanceKm: totalKm,
      totalExpectedDurationMinutes: totalMinutes,
      extractionConfidence: 0.98,
      capturedAt: new Date(snapshot.capturedAt ?? Date.now())
    });
  } catch {
    return null;
  }
}

function findBestOffer(event: RideLifecycleNativeEvent) {
  const packageName = packageForPlatform(event.platform);
  const candidates = getPendingAccessibilitySnapshots()
    .filter((snapshot) => snapshot.packageName?.toLowerCase() === packageName)
    .filter((snapshot) => {
      const at = snapshot.capturedAt ?? 0;
      return at > 0 && at <= event.detectedAt && event.detectedAt - at <= MAX_MATCH_AGE_MS;
    })
    .map((snapshot) => {
      const recovered99 = recover99Summary(snapshot);
      if (recovered99) return { offer: recovered99, capturedAt: snapshot.capturedAt ?? 0 };

      const raw = parseAccessibilitySnapshot(snapshot);
      if (!raw) return null;
      try {
        return { offer: normalizeRideOffer(raw), capturedAt: snapshot.capturedAt ?? 0 };
      } catch {
        return null;
      }
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((a, b) => b.capturedAt - a.capturedAt);

  return candidates[0]?.offer ?? null;
}

export interface RideLifecycleInboxResult {
  processed: number;
  pending: number;
  errors: string[];
}

/**
 * Imports native end-of-ride confirmations into the normal MotoristaPro ledger.
 *
 * Native accessibility is intentionally responsible only for the lifecycle signal and
 * the driver's one-tap payment choice. Booking remains here so all financial writes
 * continue through RideOfferService/RideResultService/TransactionService and their
 * existing offline/Supabase sync rules.
 */
export async function processRideLifecycleInbox(userId: string): Promise<RideLifecycleInboxResult> {
  const events = getPendingRideLifecycleEvents();
  const confirmations = events.filter((event) => event.state === "payment_confirmed");
  if (confirmations.length === 0) return { processed: 0, pending: 0, errors: [] };

  const processedKeys = await readProcessed();
  const session = await getActiveWorkSession(userId);
  let processed = 0;
  let pending = 0;
  const errors: string[] = [];

  for (const event of confirmations) {
    const key = eventKey(event);
    if (processedKeys.has(key)) continue;

    const method = paymentMethod(event);
    if (!method) {
      pending += 1;
      errors.push(`Forma de recebimento inválida para ${event.platform}.`);
      continue;
    }

    const normalized = findBestOffer(event);
    if (!normalized) {
      pending += 1;
      errors.push(`Não encontrei uma oferta ${event.platform} confiável para vincular ao recebimento.`);
      continue;
    }

    try {
      const offer = await addRideOffer({
        userId,
        vehicleId: session?.vehicle_id ?? null,
        workSessionId: session?.id ?? null,
        offer: normalized,
        thresholds: DEFAULT_THRESHOLDS
      });

      await completeRideAndBookIncome({
        userId,
        rideOfferId: offer.id,
        paymentMethod: method,
        finalAmountCents: normalized.offeredAmountCents + normalized.additionalPayCents,
        actualDistanceKm: normalized.totalExpectedDistanceKm,
        actualDurationMinutes: normalized.totalExpectedDurationMinutes,
        endedAt: new Date(event.detectedAt)
      });

      processedKeys.add(key);
      processed += 1;
    } catch (error: any) {
      pending += 1;
      errors.push(error?.message ?? `Falha ao contabilizar corrida ${event.platform}.`);
    }
  }

  await writeProcessed(processedKeys);
  if (pending === 0) clearPendingRideLifecycleEvents();
  return { processed, pending, errors };
}
