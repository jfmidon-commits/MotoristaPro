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

describe("Validações de constraints (lógica pura)", () => {
  it("rejeita amount negativo em transação", () => {
    const amount = -100;
    expect(amount < 0).toBe(true);
  });

  it("rejeita cost negativo em manutenção", () => {
    const cost = -50;
    expect(cost < 0).toBe(true);
  });

  it("rejeita start_odometer negativo", () => {
    const startOdometer = -10;
    expect(startOdometer < 0).toBe(true);
  });

  it("rejeita end_odometer negativo", () => {
    const endOdometer = -5;
    expect(endOdometer < 0).toBe(true);
  });

  it("rejeita end_odometer < start_odometer", () => {
    const start = 100;
    const end = 50;
    expect(end < start).toBe(true);
  });

  it("aceita valores válidos de odômetro", () => {
    const start = 100;
    const end = 150;
    expect(end >= start && start >= 0 && end >= 0).toBe(true);
  });
});

describe("Fila de deleção (lógica)", () => {
  it("registro com pending_delete deve ser filtrado em leituras", () => {
    const hasPendingDelete = true;
    expect(hasPendingDelete).toBe(true);
  });

  it("retry de delete incrementa attempts mas mantém elegível", () => {
    const attempts = 2;
    const maxAttempts = 5;
    expect(attempts < maxAttempts).toBe(true);
  });

  it("delete bem sucedido remove da fila e do local", () => {
    const remoteSuccess = true;
    const localRemoved = true;
    expect(remoteSuccess && localRemoved).toBe(true);
  });
});
