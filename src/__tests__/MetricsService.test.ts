jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/services/WorkSessionService", () => ({ getWorkSessionsBetween: jest.fn() }));

import { getDb } from "@/lib/database";
import { computeMetrics } from "@/services/MetricsService";
import { getWorkSessionsBetween } from "@/services/WorkSessionService";
import type { Transaction, WorkSession } from "@/types";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetWorkSessionsBetween = getWorkSessionsBetween as jest.MockedFunction<
  typeof getWorkSessionsBetween
>;

const baseTransaction = {
  user_id: "user-1",
  vehicle_id: null,
  category: "test",
  description: null,
  occurred_at: "2026-08-21T10:00:00.000Z",
  created_at: "2026-08-21T10:00:00.000Z",
  sync_state: "synced" as const,
  sync_error: null
};

describe("computeMetrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calcula receita, despesa, lucro, horas e km do período", async () => {
    const transactions: Transaction[] = [
      { ...baseTransaction, id: "t1", type: "income", amount: 10_000 },
      { ...baseTransaction, id: "t2", type: "expense", amount: 2_500 }
    ];
    const sessions: WorkSession[] = [
      {
        id: "s1",
        user_id: "user-1",
        vehicle_id: null,
        started_at: "2026-08-21T10:00:00.000Z",
        ended_at: "2026-08-21T12:00:00.000Z",
        start_odometer_km: 1000,
        end_odometer_km: 1050,
        created_at: "2026-08-21T10:00:00.000Z"
      }
    ];

    mockedGetDb.mockResolvedValue({ getAllAsync: jest.fn().mockResolvedValue(transactions) } as never);
    mockedGetWorkSessionsBetween.mockResolvedValue(sessions);

    await expect(
      computeMetrics("user-1", "2026-08-21T00:00:00.000Z", "2026-08-21T23:59:59.999Z")
    ).resolves.toEqual({
      grossIncome: 10_000,
      totalExpense: 2_500,
      netProfit: 7_500,
      totalKm: 50,
      totalHours: 2,
      perHourCents: 3_750,
      perKmCents: 150,
      costPerKmCents: 50,
      transactionCount: 2
    });
  });

  it("não inventa métricas por hora/km quando não existem turnos", async () => {
    mockedGetDb.mockResolvedValue({ getAllAsync: jest.fn().mockResolvedValue([]) } as never);
    mockedGetWorkSessionsBetween.mockResolvedValue([]);

    const result = await computeMetrics(
      "user-1",
      "2026-08-21T00:00:00.000Z",
      "2026-08-21T23:59:59.999Z"
    );

    expect(result.perHourCents).toBeNull();
    expect(result.perKmCents).toBeNull();
    expect(result.costPerKmCents).toBeNull();
  });
});
