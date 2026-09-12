import type { AccessibilityNodeSnapshot, AccessibilitySnapshot } from "../../modules/motorista-notification-listener";

export type StructuralOfferConfidence = "none" | "low" | "medium" | "high";

export interface StructuralOfferAssessment {
  candidate: boolean;
  confidence: StructuralOfferConfidence;
  reasons: string[];
  windowId: number | null;
}

const VIEW_ID_HINTS = /offer|request|accept|trip|dispatch|ride|card|sheet|modal|bottom|button/i;
const CLASS_HINTS = /Button|TextView/i;
const OPERATIONAL_RESIDUAL = /R\$|\b\d+(?:[.,]\d+)?\s*(?:km|m|min)\b|aceitar|oferta|uberx|comfort|black|nova solicita[cç][aã]o/i;

function hasGeometry(node: AccessibilityNodeSnapshot): boolean {
  const left = node.left ?? 0;
  const top = node.top ?? 0;
  const right = node.right ?? 0;
  const bottom = node.bottom ?? 0;
  return right > left && bottom > top;
}

function area(node: AccessibilityNodeSnapshot): number {
  const left = node.left ?? 0;
  const top = node.top ?? 0;
  const right = node.right ?? 0;
  const bottom = node.bottom ?? 0;
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function groupByWindow(nodes: AccessibilityNodeSnapshot[]): Map<number, AccessibilityNodeSnapshot[]> {
  const grouped = new Map<number, AccessibilityNodeSnapshot[]>();
  for (const node of nodes) {
    const windowId = typeof node.windowId === "number" ? node.windowId : -1;
    const bucket = grouped.get(windowId) ?? [];
    bucket.push(node);
    grouped.set(windowId, bucket);
  }
  return grouped;
}

export function assessUberStructuralOffer(snapshot: AccessibilitySnapshot): StructuralOfferAssessment {
  if ((snapshot.packageName ?? "").toLowerCase() !== "com.ubercab.driver") {
    return { candidate: false, confidence: "none", reasons: [], windowId: null };
  }

  const nodes = (snapshot.nodes ?? []).filter((node) =>
    Boolean(node.viewId || node.className || node.clickable || node.text || hasGeometry(node))
  );
  if (nodes.length < 5) {
    return { candidate: false, confidence: "none", reasons: [], windowId: null };
  }

  let best: StructuralOfferAssessment = { candidate: false, confidence: "none", reasons: [], windowId: null };

  for (const [windowId, windowNodes] of groupByWindow(nodes)) {
    const clickable = windowNodes.filter((node) => node.clickable === true && hasGeometry(node));
    const typed = windowNodes.filter((node) => CLASS_HINTS.test(node.className ?? ""));
    const hintedIds = windowNodes.filter((node) => VIEW_ID_HINTS.test(node.viewId ?? ""));
    const nonEmptyTexts = windowNodes.map((node) => (node.text ?? "").trim()).filter(Boolean);
    const hasResidual = nonEmptyTexts.some((text) => OPERATIONAL_RESIDUAL.test(text));
    const fromRichOrigin = windowNodes.some((node) => node.origin === "eventSource" || node.origin === "window");
    const largestClickable = clickable.reduce((max, node) => Math.max(max, area(node)), 0);

    const reasons: string[] = [];
    if (clickable.length > 0) reasons.push("nó clicável com geometria");
    if (typed.length >= 3) reasons.push("grupo de TextView/Button");
    if (hintedIds.length > 0) reasons.push("viewId com indício de card/aceite");
    if (fromRichOrigin) reasons.push("capturado por eventSource/window");
    if (hasResidual) reasons.push("fragmento operacional residual");
    if (largestClickable >= 20_000) reasons.push("controle clicável de área relevante");

    const high =
      clickable.length >= 1 &&
      typed.length >= 3 &&
      fromRichOrigin &&
      (hintedIds.length >= 1 || hasResidual) &&
      largestClickable >= 20_000;

    const medium =
      clickable.length >= 1 &&
      typed.length >= 4 &&
      fromRichOrigin &&
      (hintedIds.length >= 1 || largestClickable >= 30_000);

    const low =
      clickable.length >= 1 &&
      typed.length >= 3 &&
      fromRichOrigin;

    const confidence: StructuralOfferConfidence = high ? "high" : medium ? "medium" : low ? "low" : "none";
    const rank = { none: 0, low: 1, medium: 2, high: 3 }[confidence];
    const bestRank = { none: 0, low: 1, medium: 2, high: 3 }[best.confidence];

    if (rank > bestRank) {
      best = {
        candidate: confidence !== "none",
        confidence,
        reasons,
        windowId: windowId >= 0 ? windowId : null
      };
    }
  }

  return best;
}
