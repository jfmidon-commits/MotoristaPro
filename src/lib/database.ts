import * as SQLite from "expo-sqlite";

let dbInstance: SQLite.SQLiteDatabase | null = null;

const LATEST_DB_VERSION = 3;

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
      description TEXT NOT NULL,
      cost INTEGER NOT NULL CHECK (cost >= 0),
      odometer_km INTEGER CHECK (odometer_km IS NULL OR odometer_km >= 0),
      performed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
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
    CREATE INDEX IF NOT EXISTS idx_work_sessions_user_started ON work_sessions(user_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_work_sessions_user ON work_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);
    CREATE INDEX IF NOT EXISTS idx_preventive_plans_user ON preventive_maintenance_plans(user_id);
    CREATE INDEX IF NOT EXISTS idx_preventive_plans_vehicle ON preventive_maintenance_plans(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_preventive_plans_user_vehicle ON preventive_maintenance_plans(user_id, vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_preventive_plans_sync ON preventive_maintenance_plans(sync_state);
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
    DELETE FROM preventive_maintenance_plans;
    DELETE FROM work_sessions;
    DELETE FROM maintenance_events;
    DELETE FROM transactions;
    DELETE FROM vehicles;
    DELETE FROM pending_deletes;
  `);
}
