import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  `CREATE TABLE statements (
     id INTEGER PRIMARY KEY,
     file_name TEXT NOT NULL,
     imported_at TEXT NOT NULL
   );
   CREATE TABLE transactions (
     id INTEGER PRIMARY KEY,
     statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
     reference TEXT NOT NULL UNIQUE,
     occurred_at TEXT NOT NULL,
     description TEXT NOT NULL,
     amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
     currency TEXT NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
     direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
     type TEXT NOT NULL,
     category TEXT NOT NULL,
     counterparty TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX idx_transactions_occurred ON transactions(occurred_at);
   CREATE INDEX idx_transactions_category ON transactions(category);
   CREATE INDEX idx_transactions_type ON transactions(type);`,
];

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version > MIGRATIONS.length) throw new Error('Database is newer than this application');
  for (let i = version; i < MIGRATIONS.length; i += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}
