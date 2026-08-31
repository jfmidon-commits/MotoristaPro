import { decideRide } from "@/services/DecisionEngine";
import { estimateRideProfit } from "@/services/ProfitEngine";

describe("DecisionEngine", () => {
  it("classifica como good quando atende aos dois pisos", () => {
    const profit = estimateRideProfit({
      offeredAmountCents: 4145,
      totalDistanceKm: 21.3,
      totalDurationMinutes: 43,
      costPerKmCents: 60
    });
    const decision = decideRide(profit, {
      minNetPerHourCents: 3500,
      minNetPerKmCents: 120
    }, 0.95);

    expect(decision.label).toBe("good");
    expect(decision.expectedNetPerHourCents).toBe(4000);
    expect(decision.expectedNetPerKmCents).toBe(135);
    expect(decision.reasonsPositive).toHaveLength(2);
    expect(decision.confidence).toBe(0.95);
  });

  it("classifica como bad quando fica materialmente abaixo do piso", () => {
    const profit = estimateRideProfit({
      offeredAmountCents: 1000,
      totalDistanceKm: 10,
      totalDurationMinutes: 30,
      costPerKmCents: 50
    });
    const decision = decideRide(profit, {
      minNetPerHourCents: 3500,
      minNetPerKmCents: 120,
      borderlineTolerancePercent: 15
    });

    expect(decision.label).toBe("bad");
    expect(decision.reasonsNegative.length).toBeGreaterThan(0);
  });

  it("usa borderline quando faltam todos os dados de produtividade", () => {
    const profit = estimateRideProfit({
      offeredAmountCents: 2000,
      totalDistanceKm: null,
      totalDurationMinutes: null
    });
    const decision = decideRide(profit, {
      minNetPerHourCents: 3500,
      minNetPerKmCents: 120
    });

    expect(decision.label).toBe("borderline");
    expect(decision.confidence).toBe(0);
  });

  it("não sinaliza good quando apenas uma das métricas-mãe está disponível", () => {
    const profit = estimateRideProfit({
      offeredAmountCents: 3000,
      totalDistanceKm: null,
      totalDurationMinutes: 30,
      costPerKmCents: 0
    });
    const decision = decideRide(profit, {
      minNetPerHourCents: 3500,
      minNetPerKmCents: 120
    });

    expect(decision.expectedNetPerHourCents).toBe(6000);
    expect(decision.expectedNetPerKmCents).toBeNull();
    expect(decision.label).toBe("borderline");
    expect(decision.confidence).toBe(0.5);
  });
});
