import { parseAccessibilitySnapshot, __test } from "@/services/AccessibilityOfferParser";
import type { AccessibilityNodeSnapshot, AccessibilitySnapshot } from "../../modules/motorista-notification-listener";

function node(text: string, top: number, left = 0): AccessibilityNodeSnapshot {
  return {
    text,
    top,
    left,
    right: left + 420,
    bottom: top + 56,
    className: "OcrLine",
    origin: "screenshotOcr"
  };
}

function snapshot(nodes: AccessibilityNodeSnapshot[]): AccessibilitySnapshot {
  return {
    packageName: "com.ubercab.driver",
    capturedAt: Date.now(),
    nodeCount: nodes.length,
    nodes,
    origins: ["screenshotOcr"]
  };
}

describe("AccessibilityOfferParser OCR real Uber", () => {
  it("preserva ponto decimal usado pela Uber em km", () => {
    expect(__test.parseDecimal("3.7")).toBe(3.7);
    expect(__test.parseDecimal("14.9")).toBe(14.9);
    expect(__test.parseDecimal("28,24")).toBe(28.24);
  });

  it("extrai a oferta observada no aparelho: Comfort R$ 28,24", () => {
    const s = snapshot([
      node("Comfort", 100),
      node("Exclusivo", 100, 450),
      node("R$ 28,24", 180),
      node("R$1,52/km aprox.", 250),
      node("4,84 (180)", 320),
      node("+R$ 1,75 incluido", 390),
      node("9 min (3.7 km)", 520),
      node("29 minutos (14.9 km)", 700),
      { ...node("Aceitar", 900), clickable: true }
    ]);

    const parsed = parseAccessibilitySnapshot(s);
    expect(parsed).not.toBeNull();
    expect(parsed!.platform).toBe("uber");
    expect(parsed!.category).toBe("Comfort");
    expect(parsed!.offeredAmount).toBe(28.24);
    expect(parsed!.pickupDurationMinutes).toBe(9);
    expect(parsed!.pickupDistanceKm).toBe(3.7);
    expect(parsed!.tripDurationMinutes).toBe(29);
    expect(parsed!.tripDistanceKm).toBe(14.9);
    expect(parsed!.extractionConfidence).toBeGreaterThan(0.5);
  });

  it("não confunde +R$ incluido com o valor principal", () => {
    const s = snapshot([
      node("Comfort", 100),
      node("R$ 28,24", 180),
      node("+R$ 1,75 incluido", 260),
      node("9 min (3.7 km)", 420),
      node("29 minutos (14.9 km)", 560),
      { ...node("Aceitar", 800), clickable: true }
    ]);

    expect(parseAccessibilitySnapshot(s)!.offeredAmount).toBe(28.24);
  });

  it("aceita substituições OCR comuns RS/R5 para R$", () => {
    const s = snapshot([
      node("UberX", 100),
      node("RS 14,45", 180),
      node("2 min (0.3 km)", 400),
      node("22 minutos (10.2 km)", 560),
      { ...node("Aceitar", 800), clickable: true }
    ]);

    const parsed = parseAccessibilitySnapshot(s);
    expect(parsed).not.toBeNull();
    expect(parsed!.offeredAmount).toBe(14.45);
    expect(parsed!.pickupDistanceKm).toBe(0.3);
    expect(parsed!.tripDistanceKm).toBe(10.2);
  });
});
