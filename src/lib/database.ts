import * as SQLite from "expo-sqlite";

let dbInstance: SQLite.SQLiteDatabase | null = null;

const LATEST_DB_VERSION = 5;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync("motorista_pro.db");
  await migrate(dbInstance);
  return dbInstance;
}

type TableInfoRow = {
  name: string;
};

async function hasColumn(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const columns = await db.getAllAsync<TableInfoRow>(`PRAGMA table_info(${tableName});`);
  return columns.some((column) => column.name === columnName);
}

async function migrate(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      plate TEXT,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      vehicle_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('income','expense')),
      category TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 0),
      description TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_events (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      preventive_plan_id TEXT,
      description TEXT NOT NULL,
      cost INTEGER NOT NULL CHECK (cost >= 0),
      odometer_km INTEGER CHECK (odometer_km IS NULL OR odometer_km >= 0),
      performed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY (preventive_plan_id) REFERENCES preventive_maintenance_plans(id)
    );

    CREATE TABLE IF NOT EXISTS work_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      vehicle_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      start_odometer_km INTEGER CHECK (start_odometer_km IS NULL OR start_odometer_km >= 0),
      end_odometer_km INTEGER CHECK (end_odometer_km IS NULL OR end_odometer_km >= 0),
      created_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS preventive_maintenance_plans (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      category TEXT NOT NULL,
      interval_km INTEGER CHECK (interval_km IS NULL OR interval_km > 0),
      interval_days INTEGER CHECK (interval_days IS NULL OR interval_days > 0),
      warning_km INTEGER CHECK (warning_km IS NULL OR warning_km >= 0),
      warning_days INTEGER CHECK (warning_days IS NULL OR warning_days >= 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS ride_offers (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      vehicle_id TEXT,
      work_session_id TEXT,
      platform TEXT NOT NULL CHECK (platform IN ('uber','99','indrive','other')),
      category TEXT,
      captured_at TEXT NOT NULL,
      offered_amount INTEGER NOT NULL CHECK (offered_amount >= 0),
      pickup_distance_km REAL CHECK (pickup_distance_km IS NULL OR pickup_distance_km >= 0),
      pickup_duration_minutes REAL CHECK (pickup_duration_minutes IS NULL OR pickup_duration_minutes >= 0),
      trip_distance_km REAL CHECK (trip_distance_km IS NULL OR trip_distance_km >= 0),
      trip_duration_minutes REAL CHECK (trip_duration_minutes IS NULL OR trip_duration_minutes >= 0),
      total_expected_distance_km REAL CHECK (total_expected_distance_km IS NULL OR total_expected_distance_km >= 0),
      total_expected_duration_minutes REAL CHECK (total_expected_duration_minutes IS NULL OR total_expected_duration_minutes >= 0),
      approximate_origin_zone TEXT,
      approximate_destination_zone TEXT,
      additional_pay INTEGER NOT NULL DEFAULT 0 CHECK (additional_pay >= 0),
      capture_source TEXT NOT NULL,
      extraction_confidence REAL CHECK (extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
      estimated_cost INTEGER,
      expected_net_profit INTEGER,
      expected_net_per_km INTEGER,
      expected_net_per_hour INTEGER,
      decision_label TEXT CHECK (decision_label IS NULL OR decision_label IN ('good','borderline','bad')),
      decision_score INTEGER CHECK (decision_score IS NULL OR (decision_score >= 0 AND decision_score <= 100)),
      decision_reasons_positive_json TEXT,
      decision_reasons_negative_json TEXT,
      decision_confidence REAL CHECK (decision_confidence IS NULL OR (decision_confidence >= 0 AND decision_confidence <= 1)),
      created_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY (work_session_id) REFERENCES work_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS ride_results (
      id TEXT PRIMARY KEY NOT NULL,
      ride_offer_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      vehicle_id TEXT,
      final_amount INTEGER NOT NULL CHECK (final_amount >= 0),
      actual_distance_km REAL CHECK (actual_distance_km IS NULL OR actual_distance_km >= 0),
      actual_duration_minutes REAL CHECK (actual_duration_minutes IS NULL OR actual_duration_minutes >= 0),
      started_at TEXT,
      ended_at TEXT,
      estimated_cost INTEGER,
      net_profit INTEGER,
      net_per_km INTEGER,
      net_per_hour INTEGER,
      created_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      FOREIGN KEY (ride_offer_id) REFERENCES ride_offers(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS pending_deletes (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
    );
  `);

  if (!(await hasColumn(db, "work_sessions", "sync_state"))) {
    await db.execAsync(`ALTER TABLE work_sessions ADD COLUMN sync_state TEXT;`);
  }

  if (!(await hasColumn(db, "work_sessions", "sync_error"))) {
    await db.execAsync(`ALTER TABLE work_sessions ADD COLUMN sync_error TEXT;`);
  }

  if (!(await hasColumn(db, "maintenance_events", "preventive_plan_id"))) {
    await db.execAsync(`ALTER TABLE maintenance_events ADD COLUMN preventive_plan_id TEXT REFERENCES preventive_maintenance_plans(id);`);
  }

  await db.execAsync(`
    UPDATE work_sessions
    SET sync_state = 'pending'
    WHERE sync_state IS NULL;
  `);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_sync ON transactions(sync_state);
    CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON maintenance_events(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_user ON maintenance_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_plan ON maintenance_events(preventive_plan_id);
    CREATE INDEX IF NOT EXISTS idx_work_sessions_user_started ON work_sessions(user_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_work_sessions_user ON work_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);
    CREATE INDEX IF NOT EXISTS idx_preventive_plans_user ON preventive_maintenance_plans(user_id);
    CREATE INDEX IF NOT EXISTS idx_preventive_plans_vehicle ON preventive_maintenance_plans(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_preventive_plans_user_vehicle ON preventive_maintenance_plans(user_id, vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_preventive_plans_sync ON preventive_maintenance_plans(sync_state);
    CREATE INDEX IF NOT EXISTS idx_ride_offers_user_captured ON ride_offers(user_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_ride_offers_work_session ON ride_offers(work_session_id);
    CREATE INDEX IF NOT EXISTS idx_ride_offers_sync ON ride_offers(sync_state);
    CREATE INDEX IF NOT EXISTS idx_ride_results_user ON ride_results(user_id);
    CREATE INDEX IF NOT EXISTS idx_ride_results_offer ON ride_results(ride_offer_id);
    CREATE INDEX IF NOT EXISTS idx_ride_results_sync ON ride_results(sync_state);
    CREATE INDEX IF NOT EXISTS idx_pending_deletes_user ON pending_deletes(user_id);
    CREATE INDEX IF NOT EXISTS idx_pending_deletes_sync ON pending_deletes(sync_state);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_deletes_record
      ON pending_deletes(user_id, table_name, record_id);
  `);

  const versionResult = await db.getFirstAsync<{ user_version: number }>(`PRAGMA user_version;`);
  const currentVersion = versionResult?.user_version ?? 0;

  if (currentVersion < LATEST_DB_VERSION) {
    await db.execAsync(`PRAGMA user_version = ${LATEST_DB_VERSION};`);
  }
}

/** Usado apenas em debug manual — nunca chamado automaticamente pelo app. */
export async function DEBUG_wipeLocalDb() {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM ride_results;
    DELETE FROM ride_offers;
    DELETE FROM preventive_maintenance_plans;
    DELETE FROM work_sessions;
    DELETE FROM maintenance_events;
    DELETE FROM transactions;
    DELETE FROM vehicles;
    DELETE FROM pending_deletes;
  `);
}
