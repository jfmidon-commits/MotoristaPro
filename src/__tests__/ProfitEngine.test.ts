import { estimateRideProfit } from "@/services/ProfitEngine";

describe("ProfitEngine", () => {
  it("calcula métricas da fixture Uber em centavos", () => {
    const result = estimateRideProfit({
      offeredAmountCents: 4145,
      totalDistanceKm: 21.3,
      totalDurationMinutes: 43,
      costPerKmCents: 60
    });

    expect(result.grossRevenueCents).toBe(4145);
    expect(result.estimatedCostCents).toBe(1278);
    expect(result.expectedNetProfitCents).toBe(2867);
    expect(result.grossPerKmCents).toBe(195);
    expect(result.netPerKmCents).toBe(135);
    expect(result.netPerHourCents).toBe(4000);
  });

  it("protege divisão por zero e dados ausentes", () => {
    const result = estimateRideProfit({
      offeredAmountCents: 1000,
      totalDistanceKm: 0,
      totalDurationMinutes: null
    });

    expect(result.grossPerKmCents).toBeNull();
    expect(result.grossPerHourCents).toBeNull();
    expect(result.netPerKmCents).toBeNull();
    expect(result.netPerHourCents).toBeNull();
  });

  it("nunca transforma custo negativo em crédito", () => {
    const result = estimateRideProfit({
      offeredAmountCents: 1000,
      totalDistanceKm: 10,
      totalDurationMinutes: 20,
      costPerKmCents: -50,
      fixedCostCents: -100
    });
    expect(result.estimatedCostCents).toBe(0);
    expect(result.expectedNetProfitCents).toBe(1000);
  });
});
