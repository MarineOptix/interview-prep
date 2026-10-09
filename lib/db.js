/**
 * Storage: one SQLite file in DATA_DIR. It holds access codes and counters only; no conversation, recording or report is ever written here.
 * Moving to another server means copying this one file.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const FILE_NAME = 'passmuster.db';

// Each entry runs once, in order; the database remembers how many have run (PRAGMA user_version).
const MIGRATIONS = [
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE access (
    code TEXT PRIMARY KEY,
    service TEXT NOT NULL DEFAULT 'rehearsal' CHECK (service IN ('rehearsal', 'assessment')),
    total INTEGER NOT NULL CHECK (total >= 0),
    used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= total),
    expires_at TEXT,
    source TEXT NOT NULL CHECK (source IN ('free', 'promo', 'payment', 'invoice')),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL REFERENCES access (code),
    position TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    turns INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'charged', 'finished'))
  );
  CREATE INDEX sessions_code ON sessions (code);

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    code TEXT NOT NULL REFERENCES access (code),
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (provider, external_id)
  );
  `,
];

export function dataDir(env = process.env) {
  return resolve(env.DATA_DIR || '/data');
}

export function dbFile(env = process.env) {
  return join(dataDir(env), FILE_NAME);
}

/** Opens a database file (or a private in-memory one) and brings its tables up to date. */
export function openDb(file = ':memory:', now = new Date()) {
  // Loaded on first use: the SQLite module built into Node 22 is still marked experimental, and pages that need no storage should not depend on it.
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('created_at', now.toISOString());
  return db;
}

let shared = null;

/** The server's database, opened on first use at DATA_DIR/passmuster.db. */
export function getDb(env = process.env) {
  if (!shared) {
    mkdirSync(dataDir(env), { recursive: true });
    shared = openDb(dbFile(env));
  }
  return shared;
}

export function closeDb() {
  shared?.close();
  shared = null;
}

/** Runs fn inside a write transaction; rolls back if it throws. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite has already ended the transaction (disk or I/O error); the first error is the one to report.
    }
    throw err;
  }
}

/** Counts for the owner's check page. Never includes a code. */
export function storageStatus(db) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    createdAt: db.prepare("SELECT value FROM meta WHERE key = 'created_at'").get()?.value ?? null,
    codes: count('access'),
    sessions: count('sessions'),
    payments: count('payments'),
  };
}
