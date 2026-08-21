import * as SQLite from "expo-sqlite";

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync("motorista_pro.db");
  await migrate(dbInstance);
  return dbInstance;
}

async function migrate(db: SQLite.SQLiteDatabase) {
  // WAL mode
  await db.execAsync(`PRAGMA journal_mode = WAL;`);

  // Schema base (idempotente via IF NOT EXISTS)
  await db.execAsync(`
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
      sync_state TEXT,
      sync_error TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_sync ON transactions(sync_state);
    CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON maintenance_events(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_work_sessions_user_started ON work_sessions(user_id, started_at);
  `);

  // Migrações incrementais controladas por user_version
  const versionResult = await db.getFirstAsync<{ user_version: number }>(`PRAGMA user_version;`);
  const currentVersion = versionResult?.user_version ?? 0;

  if (currentVersion < 1) {
    // v1: adiciona sync_state/sync_error a work_sessions (instalações antigas)
    await db.execAsync(`
      ALTER TABLE work_sessions ADD COLUMN sync_state TEXT;
      ALTER TABLE work_sessions ADD COLUMN sync_error TEXT;
    `);
    // Atualiza registros existentes para synced (já estavam no banco, presumimos sincronizados)
    await db.execAsync(`UPDATE work_sessions SET sync_state = 'synced' WHERE sync_state IS NULL;`);
    await db.setVersionAsync(1);
  }

  if (currentVersion < 2) {
    // v2: tabela pending_deletes + índices adicionais
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS pending_deletes (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sync_state TEXT NOT NULL DEFAULT 'pending',
        sync_error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_pending_deletes_user ON pending_deletes(user_id);
      CREATE INDEX IF NOT EXISTS idx_pending_deletes_sync ON pending_deletes(sync_state);
      CREATE INDEX IF NOT EXISTS idx_work_sessions_user ON work_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);
      CREATE INDEX IF NOT EXISTS idx_maintenance_user ON maintenance_events(user_id);
    `);
    await db.setVersionAsync(2);
  }
}

/** Usado apenas em debug manual — nunca chamado automaticamente pelo app. */
export async function DEBUG_wipeLocalDb() {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM work_sessions;
    DELETE FROM maintenance_events;
    DELETE FROM transactions;
    DELETE FROM vehicles;
    DELETE FROM pending_deletes;
  `);
}
