import { calculateDerivedMetrics } from "@/services/DerivedMetrics";

describe("calculateDerivedMetrics", () => {
  it("calcula lucro e métricas por hora/km", () => {
    expect(
      calculateDerivedMetrics({
        grossIncome: 10_000,
        totalExpense: 2_500,
        totalHours: 2,
        totalKm: 50
      })
    ).toEqual({
      netProfit: 7_500,
      perHourCents: 3_750,
      perKmCents: 150,
      costPerKmCents: 50
    });
  });

  it("retorna null quando não há horas nem km", () => {
    expect(
      calculateDerivedMetrics({
        grossIncome: 10_000,
        totalExpense: 2_500,
        totalHours: 0,
        totalKm: 0
      })
    ).toEqual({
      netProfit: 7_500,
      perHourCents: null,
      perKmCents: null,
      costPerKmCents: null
    });
  });

  it("mantém resultado negativo quando despesas superam receita", () => {
    expect(
      calculateDerivedMetrics({
        grossIncome: 2_000,
        totalExpense: 5_000,
        totalHours: 2,
        totalKm: 100
      })
    ).toEqual({
      netProfit: -3_000,
      perHourCents: -1_500,
      perKmCents: -30,
      costPerKmCents: 50
    });
  });
});
