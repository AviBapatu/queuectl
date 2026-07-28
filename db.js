const Database = require('better-sqlite3');
const path = require('path');

// Store the DB in the current working directory
const dbPath = path.resolve(process.cwd(), 'queuectl.db');
const db = new Database(dbPath, {
  wal: true,
});

// Enable WAL mode and foreign keys for data integrity and concurrency
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function initDb() {
  // 1. The Jobs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      priority INTEGER DEFAULT 0,
      run_at INTEGER DEFAULT 0,
      locked_by INTEGER,
      heartbeat_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      output TEXT
    )
  `);

  // Ensure priority and output columns exist if upgrading an existing schema
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN priority INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN output TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  // 2. The Workers Table (For IPC and graceful shutdowns)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      pid INTEGER PRIMARY KEY,
      status TEXT DEFAULT 'active',
      started_at INTEGER
    )
  `);

  // 3. The Config Table (For dynamic settings)
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Insert default configs if they don't exist
  db.exec(`DELETE FROM config WHERE key = 'max-retries'`);
  db.exec(`INSERT OR IGNORE INTO config (key, value) VALUES ('backoff_base', '2')`);
  db.exec(`INSERT OR IGNORE INTO config (key, value) VALUES ('max_retries', '3')`);
  db.exec(`INSERT OR IGNORE INTO config (key, value) VALUES ('timeout_ms', '30000')`);
}

initDb();

module.exports = db;
