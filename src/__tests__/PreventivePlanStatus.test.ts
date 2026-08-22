import { calculatePreventivePlanStatus } from "@/services/PreventivePlanStatus";

describe("calculatePreventivePlanStatus", () => {
  it("fica OK quando ainda há margem de km", () => {
    const result = calculatePreventivePlanStatus({
      intervalKm: 10_000,
      warningKm: 1_000,
      lastOdometerKm: 50_000,
      currentOdometerKm: 57_000
    });
    expect(result).toEqual({ remainingKm: 3_000, remainingDays: null, status: "ok" });
  });

  it("fica EM BREVE ao entrar na faixa de aviso por km", () => {
    const result = calculatePreventivePlanStatus({
      intervalKm: 10_000,
      warningKm: 1_000,
      lastOdometerKm: 50_000,
      currentOdometerKm: 59_000
    });
    expect(result.remainingKm).toBe(1_000);
    expect(result.status).toBe("soon");
  });

  it("fica VENCIDO ao ultrapassar km", () => {
    const result = calculatePreventivePlanStatus({
      intervalKm: 10_000,
      warningKm: 1_000,
      lastOdometerKm: 50_000,
      currentOdometerKm: 60_500
    });
    expect(result.remainingKm).toBe(-500);
    expect(result.status).toBe("overdue");
  });

  it("fica OK por data quando ainda há margem", () => {
    const result = calculatePreventivePlanStatus({
      intervalDays: 180,
      warningDays: 15,
      lastPerformedAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-05-01T00:00:00.000Z")
    });
    expect(result.remainingDays).toBeGreaterThan(15);
    expect(result.status).toBe("ok");
  });

  it("fica EM BREVE por data", () => {
    const result = calculatePreventivePlanStatus({
      intervalDays: 30,
      warningDays: 7,
      lastPerformedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-25T00:00:00.000Z")
    });
    expect(result.remainingDays).toBe(6);
    expect(result.status).toBe("soon");
  });

  it("fica VENCIDO por data", () => {
    const result = calculatePreventivePlanStatus({
      intervalDays: 30,
      warningDays: 7,
      lastPerformedAt: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-08-21T00:00:00.000Z")
    });
    expect(result.remainingDays).toBeLessThanOrEqual(0);
    expect(result.status).toBe("overdue");
  });

  it("usa o status mais urgente quando km e data coexistem", () => {
    const result = calculatePreventivePlanStatus({
      intervalKm: 10_000,
      warningKm: 1_000,
      lastOdometerKm: 50_000,
      currentOdometerKm: 52_000,
      intervalDays: 30,
      warningDays: 7,
      lastPerformedAt: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-08-21T00:00:00.000Z")
    });
    expect(result.remainingKm).toBe(8_000);
    expect(result.status).toBe("overdue");
  });

  it("retorna unknown quando não existe referência suficiente", () => {
    const result = calculatePreventivePlanStatus({
      intervalKm: 10_000,
      warningKm: 1_000,
      currentOdometerKm: 52_000
    });
    expect(result).toEqual({ remainingKm: null, remainingDays: null, status: "unknown" });
  });

  it("não trata zero de warning como ausência", () => {
    const result = calculatePreventivePlanStatus({
      intervalKm: 10_000,
      warningKm: 0,
      lastOdometerKm: 50_000,
      currentOdometerKm: 60_000
    });
    expect(result.status).toBe("overdue");
  });
});
