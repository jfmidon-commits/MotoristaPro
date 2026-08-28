import { getDb } from "@/lib/database";

export interface OdometerConsistency {
  latestKnownKm: number | null;
  enteredKm: number;
  isLowerThanKnown: boolean;
  differenceKm: number;
}

export function evaluateOdometerConsistency(
  enteredKm: number,
  latestKnownKm: number | null
): OdometerConsistency {
  const differenceKm = latestKnownKm == null ? 0 : latestKnownKm - enteredKm;
  return {
    latestKnownKm,
    enteredKm,
    isLowerThanKnown: latestKnownKm != null && enteredKm < latestKnownKm,
    differenceKm: Math.max(0, differenceKm)
  };
}

export async function getLatestKnownOdometerForVehicle(
  userId: string,
  vehicleId: string
): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ odometer_km: number | null }>(
    `SELECT MAX(value) AS odometer_km FROM (
       SELECT end_odometer_km AS value FROM work_sessions
       WHERE user_id = ? AND vehicle_id = ? AND end_odometer_km IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM pending_deletes pd
           WHERE pd.user_id = ? AND pd.table_name = 'work_sessions' AND pd.record_id = work_sessions.id
         )
       UNION ALL
       SELECT start_odometer_km AS value FROM work_sessions
       WHERE user_id = ? AND vehicle_id = ? AND start_odometer_km IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM pending_deletes pd
           WHERE pd.user_id = ? AND pd.table_name = 'work_sessions' AND pd.record_id = work_sessions.id
         )
       UNION ALL
       SELECT odometer_km AS value FROM maintenance_events
       WHERE user_id = ? AND vehicle_id = ? AND odometer_km IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM pending_deletes pd
           WHERE pd.user_id = ? AND pd.table_name = 'maintenance_events' AND pd.record_id = maintenance_events.id
         )
     )`,
    [userId, vehicleId, userId, userId, vehicleId, userId, userId, vehicleId, userId]
  );
  return row?.odometer_km ?? null;
}
