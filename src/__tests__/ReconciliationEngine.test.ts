import { reconcileRide } from "@/services/ReconciliationEngine";

describe("ReconciliationEngine", () => {
  it("detecta divergência relevante no exemplo 5km/10min para 7km/15min", () => {
    const result = reconcileRide(
      {
        offered_amount: 1000,
        total_expected_distance_km: 5,
        total_expected_duration_minutes: 10
      },
      {
        final_amount: 1000,
        actual_distance_km: 7,
        actual_duration_minutes: 15
      }
    );

    expect(result.distanceDeltaKm).toBe(2);
    expect(result.distanceDeltaPercent).toBeCloseTo(40);
    expect(result.durationDeltaMinutes).toBe(5);
    expect(result.durationDeltaPercent).toBeCloseTo(50);
    expect(result.offeredGrossPerKmCents).toBe(200);
    expect(result.actualGrossPerKmCents).toBe(143);
    expect(result.isRelevantDivergence).toBe(true);
    expect(result.reviewMessage).toBe("Vale verificar a opção de revisão desta corrida.");
  });

  it("não sinaliza direito automático a reajuste", () => {
    const result = reconcileRide(
      {
        offered_amount: 1000,
        total_expected_distance_km: 5,
        total_expected_duration_minutes: 10
      },
      {
        final_amount: 1000,
        actual_distance_km: 5.2,
        actual_duration_minutes: 10.5
      }
    );

    expect(result.isRelevantDivergence).toBe(false);
    expect(result.reviewMessage).toBeNull();
  });

  it("considera adicional da oferta ao comparar o valor final", () => {
    const result = reconcileRide(
      {
        offered_amount: 1000,
        additional_pay: 200,
        total_expected_distance_km: 6,
        total_expected_duration_minutes: 15
      },
      {
        final_amount: 1000,
        actual_distance_km: 6,
        actual_duration_minutes: 15
      }
    );

    expect(result.amountDeltaCents).toBe(-200);
    expect(result.amountDeltaPercent).toBeCloseTo(-16.67, 1);
    expect(result.offeredGrossPerKmCents).toBe(200);
    expect(result.isRelevantDivergence).toBe(true);
  });
});
