import {
  parseAccessibilitySnapshot,
  isOfferSnapshot,
  __test
} from "@/services/AccessibilityOfferParser";
import type { AccessibilitySnapshot, AccessibilityNodeSnapshot } from "../../modules/motorista-notification-listener";

function node(text: string, top = 0, left = 0, extra: Partial<AccessibilityNodeSnapshot> = {}): AccessibilityNodeSnapshot {
  return { text, top, left, right: left + 100, bottom: top + 40, ...extra };
}

function snap(packageName: string, nodes: AccessibilityNodeSnapshot[]): AccessibilitySnapshot {
  return { packageName, capturedAt: Date.now(), nodes, nodeCount: nodes.length };
}

describe("AccessibilityOfferParser", () => {
  describe("Uber fixture canônica", () => {
    it("extrai preço e pernas na ordem esperada", () => {
      const s = snap("com.ubercab.driver", [
        node("R$ 9,43", 10, 20), node("R$ 1,10/km", 50, 20), node("11 min", 100, 10), node("6,2 km", 100, 80),
        node("7 min", 160, 10), node("2,4 km", 160, 80), node("UberX", 5, 5), node("Aceitar", 220, 40, { clickable: true })
      ]);
      const raw = parseAccessibilitySnapshot(s);
      expect(raw).not.toBeNull();
      expect(raw!.offeredAmount).toBe(9.43);
      expect(raw!.pickupDurationMinutes).toBe(11);
      expect(raw!.pickupDistanceKm).toBe(6.2);
      expect(raw!.tripDurationMinutes).toBe(7);
      expect(raw!.tripDistanceKm).toBe(2.4);
      expect(raw!.platform).toBe("uber");
    });
  });

  describe("Uber nodes fora de ordem", () => {
    it("ainda distingue pickup/trip via bounds", () => {
      const s = snap("com.ubercab.driver", [
        node("7 min", 160, 10), node("2,4 km", 160, 80), node("R$ 9,43", 10, 20), node("11 min", 100, 10),
        node("6,2 km", 100, 80), node("R$ 1,10/km", 50, 20), node("Aceitar", 220, 40, { clickable: true })
      ]);
      const raw = parseAccessibilitySnapshot(s);
      expect(raw).not.toBeNull();
      expect(raw!.offeredAmount).toBe(9.43);
      expect(raw!.pickupDurationMinutes).toBe(11);
      expect(raw!.pickupDistanceKm).toBe(6.2);
      expect(raw!.tripDurationMinutes).toBe(7);
      expect(raw!.tripDistanceKm).toBe(2.4);
    });
  });

  it("reconhece assinatura fragmentada observada no aparelho real da Uber", () => {
    const s = snap("com.ubercab.driver", [
      node("50min", -609, 64, { clickable: true }),
      node("50min", -1122, 910),
      node("R$ 51,61", -797, 148),
      node("R$ 51,61", -797, 486),
      node("R$ 3,73", -797, 822),
      node("R$ 51,61", -52, 127),
      node("R$ 51,61", 60, 127),
      node("R$ 0,00", 60, 834),
      node("/ km", 497, 664),
      node("/ km", 789, 108)
    ]);

    expect(isOfferSnapshot(s)).toBe(true);
    const raw = parseAccessibilitySnapshot(s);
    expect(raw).not.toBeNull();
    expect(raw!.platform).toBe("uber");
    expect(raw!.offeredAmount).toBe(51.61);
    expect(raw!.pickupDurationMinutes).toBe(50);
    expect(raw!.extractionConfidence).toBeGreaterThanOrEqual(0.15);
  });

  it("não usa frequência se dois valores monetários repetidos empatam", () => {
    const result = __test.pickOfferAmount([
      { value: 20, raw: "R$ 20,00", isRatePerKm: false, isTariffLike: false, isBonusLike: false, isBalanceLike: false, top: 10, left: 10 },
      { value: 20, raw: "R$ 20,00", isRatePerKm: false, isTariffLike: false, isBonusLike: false, isBalanceLike: false, top: 20, left: 10 },
      { value: 30, raw: "R$ 30,00", isRatePerKm: false, isTariffLike: false, isBonusLike: false, isBalanceLike: false, top: 30, left: 10 },
      { value: 30, raw: "R$ 30,00", isRatePerKm: false, isTariffLike: false, isBonusLike: false, isBalanceLike: false, top: 40, left: 10 }
    ]);
    expect(result).toBeNull();
  });

  it("extrai 99 canônica sem somar tarifas", () => {
    const s = snap("com.app99.driver", [
      node("R$ 20,03", 10, 20), node("R$ 1,92/km", 40, 20), node("2 min", 90, 10), node("176 m", 90, 80),
      node("17 min", 150, 10), node("10,2 km", 150, 80), node("R$ 4,83 Tarifa Expresso", 200, 20),
      node("R$ 2,89 Tarifa base dinâmica", 230, 20), node("Pop", 5, 5), node("Aceitar", 280, 40, { clickable: true })
    ]);
    const raw = parseAccessibilitySnapshot(s);
    expect(raw).not.toBeNull();
    expect(raw!.offeredAmount).toBe(20.03);
    expect(raw!.pickupDurationMinutes).toBe(2);
    expect(raw!.pickupDistanceKm).toBeCloseTo(0.176, 3);
    expect(raw!.tripDurationMinutes).toBe(17);
    expect(raw!.tripDistanceKm).toBe(10.2);
  });

  it("99 fora de ordem continua pareando via bounds", () => {
    const s = snap("com.app99.driver", [
      node("10,2 km", 150, 80), node("17 min", 150, 10), node("R$ 20,03", 10, 20), node("176 m", 90, 80),
      node("2 min", 90, 10), node("R$ 1,92/km", 40, 20), node("Aceitar", 280, 40, { clickable: true })
    ]);
    const raw = parseAccessibilitySnapshot(s)!;
    expect(raw.pickupDistanceKm).toBeCloseTo(0.176, 3);
    expect(raw.tripDistanceKm).toBe(10.2);
    expect(raw.pickupDurationMinutes).toBe(2);
    expect(raw.tripDurationMinutes).toBe(17);
  });

  it("deduplica texto idêntico no mesmo bounds", () => {
    const nodes = __test.dedupeTexts([node("6,2 km", 10, 10), node("6,2 km", 10, 10), node("11 min", 20, 10)]);
    expect(nodes.filter((n) => (n.text ?? "").includes("6,2")).length).toBe(1);
  });

  it("preserva valores iguais em bounds diferentes", () => {
    const s = snap("com.ubercab.driver", [
      node("R$ 18,00", 10, 10), node("5 min", 60, 10), node("2 km", 60, 80), node("9 min", 120, 10),
      node("2 km", 120, 80), node("UberX", 20, 10), node("Aceitar", 180, 20, { clickable: true })
    ]);
    const raw = parseAccessibilitySnapshot(s)!;
    expect(raw.pickupDistanceKm).toBe(2);
    expect(raw.tripDistanceKm).toBe(2);
  });

  it("exclui R$/km da seleção de preço", () => {
    const s = snap("com.ubercab.driver", [node("R$ 1,10/km"), node("R$ 9,43", 40), node("5 min", 80), node("2 km", 80, 80), node("Aceitar", 150, 20, { clickable: true })]);
    expect(parseAccessibilitySnapshot(s)!.offeredAmount).toBe(9.43);
  });

  it("ignora saldo, bônus e promoção maiores que a oferta", () => {
    for (const extra of ["Saldo R$ 342,10", "Bônus R$ 25,00", "Promoção R$ 30,00"]) {
      const s = snap("com.app99.driver", [node(extra), node("R$ 18,00", 40), node("3 min", 80), node("2 km", 80, 80), node("Pop"), node("Aceitar", 150, 20, { clickable: true })]);
      expect(parseAccessibilitySnapshot(s)!.offeredAmount).toBe(18);
    }
  });

  it("exclui tarifas 99 antes/depois do total", () => {
    const s = snap("com.app99.driver", [
      node("R$ 4,83 Tarifa Expresso"), node("R$ 20,03", 50), node("R$ 2,89 Tarifa base dinâmica", 70),
      node("2 min", 100), node("1 km", 100, 80), node("Pop"), node("Aceitar", 200, 20, { clickable: true })
    ]);
    expect(parseAccessibilitySnapshot(s)!.offeredAmount).toBe(20.03);
  });

  it("176 m vira 0.176 km", () => {
    expect(__test.extractMetrics([node("176 m")])[0].kmValue).toBeCloseTo(0.176, 3);
  });

  it("R$0,00 não vira oferta", () => {
    const s = snap("com.ubercab.driver", [node("R$ 0,00"), node("5 min", 40), node("2 km", 40, 80), node("Aceitar", 100, 20, { clickable: true })]);
    expect(parseAccessibilitySnapshot(s)).toBeNull();
  });

  it("dois valores monetários plausíveis sem contexto retornam null", () => {
    const s = snap("com.app99.driver", [
      node("R$ 20,03", 20), node("Pedágio R$ 30,00", 40), node("2 min", 90), node("1 km", 90, 80), node("Pop"), node("Aceitar", 160, 20, { clickable: true })
    ]);
    expect(parseAccessibilitySnapshot(s)).toBeNull();
  });

  it("R$ + km + min sem marcador forte não é oferta", () => {
    const s = snap("com.ubercab.driver", [node("R$ 120,00"), node("35 km", 40), node("90 min", 70)]);
    expect(isOfferSnapshot(s)).toBe(false);
    expect(parseAccessibilitySnapshot(s)).toBeNull();
  });

  it("package fora da allowlist não é aceito", () => {
    const s = snap("com.fake.uber.helper", [node("R$ 20,00"), node("5 km", 40), node("10 min", 40, 80), node("Aceitar", 100, 20, { clickable: true })]);
    expect(parseAccessibilitySnapshot(s)).toBeNull();
  });

  it("inDrive permanece stub explícito", () => {
    const s = snap("sinet.startup.inDriver", [node("R$ 25,00"), node("10 km", 40), node("20 min", 40, 80), node("Aceitar", 100, 20, { clickable: true })]);
    expect(parseAccessibilitySnapshot(s)).toBeNull();
  });

  it("km sem preço retorna null", () => {
    const s = snap("com.ubercab.driver", [node("6,2 km"), node("11 min", 40), node("Aceitar", 80, 10, { clickable: true })]);
    expect(parseAccessibilitySnapshot(s)).toBeNull();
  });

  it("snapshot genérico não é oferta", () => {
    const s = snap("com.ubercab.driver", [node("Você está online"), node("Aceitação 92%", 40)]);
    expect(parseAccessibilitySnapshot(s)).toBeNull();
  });
});
