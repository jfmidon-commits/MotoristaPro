import {
  calculateWorkSessionMetrics,
  formatDuration
} from "@/services/WorkSessionMetricsService";

const baseSession = {
  started_at: "2026-08-21T10:00:00.000Z",
  ended_at: "2026-08-21T14:00:00.000Z",
  start_odometer_km: 1000,
  end_odometer_km: 1080
};

describe("calculateWorkSessionMetrics", () => {
  it("calcula receita, despesa, lucro e indicadores do turno encerrado", () => {
    const result = calculateWorkSessionMetrics({
      session: baseSession,
      transactions: [
        { type: "income", amount: 10_000 },
        { type: "income", amount: 5_000 },
        { type: "expense", amount: 3_500 }
      ]
    });

    expect(result.grossIncome).toBe(15_000);
    expect(result.totalExpense).toBe(3_500);
    expect(result.netProfit).toBe(11_500);
    expect(result.durationHours).toBe(4);
    expect(result.totalKm).toBe(80);
    expect(result.perHourCents).toBe(2_875);
    expect(result.perKmCents).toBe(144);
    expect(result.costPerKmCents).toBe(44);
    expect(result.transactionCount).toBe(3);
  });

  it("usa o horário atual para calcular duração de turno aberto e não inventa km", () => {
    const result = calculateWorkSessionMetrics({
      session: {
        ...baseSession,
        ended_at: null,
        end_odometer_km: null
      },
      now: new Date("2026-08-21T12:30:00.000Z"),
      transactions: [{ type: "income", amount: 5_000 }]
    });

    expect(result.durationHours).toBe(2.5);
    expect(result.totalKm).toBeNull();
    expect(result.perHourCents).toBe(2_000);
    expect(result.perKmCents).toBeNull();
    expect(result.costPerKmCents).toBeNull();
  });

  it("preserva prejuízo nas métricas", () => {
    const result = calculateWorkSessionMetrics({
      session: baseSession,
      transactions: [
        { type: "income", amount: 2_000 },
        { type: "expense", amount: 5_000 }
      ]
    });

    expect(result.netProfit).toBe(-3_000);
    expect(result.perHourCents).toBe(-750);
    // Math.round(-37.5) em JavaScript resulta em -37 (em direção a +Infinity no empate).
    expect(result.perKmCents).toBe(-37);
  });

  it("retorna métricas por km como null quando não há distância rodada", () => {
    const result = calculateWorkSessionMetrics({
      session: {
        ...baseSession,
        end_odometer_km: 1000
      },
      transactions: [{ type: "expense", amount: 1_000 }]
    });

    expect(result.totalKm).toBe(0);
    expect(result.perKmCents).toBeNull();
    expect(result.costPerKmCents).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formata horas decimais em horas e minutos", () => {
    expect(formatDuration(2.5)).toBe("2h 30min");
  });
});
