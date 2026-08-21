import * as SQLite from "expo-sqlite";

// Fonte de verdade local. O app tem que funcionar 100% offline com isso,
// mesmo que o Supabase esteja fora do ar.

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync("motorista_pro.db");
  await migrate(dbInstance);
  return dbInstance;
}

async function migrate(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      plate TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
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
      amount INTEGER NOT NULL,
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
      cost INTEGER NOT NULL,
      odometer_km INTEGER,
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
      start_odometer_km INTEGER,
      end_odometer_km INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_sync ON transactions(sync_state);
    CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON maintenance_events(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_work_sessions_user_started ON work_sessions(user_id, started_at);
  `);
}

/** Usado apenas em debug manual — nunca chamado automaticamente pelo app. */
export async function DEBUG_wipeLocalDb() {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM work_sessions;
    DELETE FROM maintenance_events;
    DELETE FROM transactions;
    DELETE FROM vehicles;
  `);
}
