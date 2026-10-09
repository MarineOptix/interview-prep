/** A daily copy of the database in DATA_DIR/backup; the newest seven are kept. */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, getDb } from './db.js';

const KEEP = 7;
const NAME = /^passmuster-\d{4}-\d{2}-\d{2}\.db$/;
const HOUR_MS = 60 * 60 * 1000;

export function backupDir(env = process.env) {
  return join(dataDir(env), 'backup');
}

export function listBackups(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((name) => NAME.test(name)).sort() : [];
}

/**
 * Writes today's copy unless it is already there, then removes copies beyond the newest `keep`.
 * Returns the file name written, or null when today's copy existed.
 */
export function backupDb(db, dir, now = new Date(), keep = KEEP) {
  mkdirSync(dir, { recursive: true });
  const name = `passmuster-${now.toISOString().slice(0, 10)}.db`;
  const target = join(dir, name);
  let written = null;
  if (!existsSync(target)) {
    // VACUUM INTO makes a consistent copy even while the database is in use. It refuses to overwrite, hence the temporary name.
    const temp = `${target}.tmp`;
    rmSync(temp, { force: true });
    db.exec(`VACUUM INTO '${temp.replaceAll("'", "''")}'`);
    renameSync(temp, target);
    written = name;
  }
  for (const old of listBackups(dir).slice(0, -keep)) rmSync(join(dir, old), { force: true });
  return written;
}

/**
 * Makes a copy now if today's is missing and checks again every hour.
 * Returns false, and schedules nothing, when the database cannot be opened at start-up; a later failure is logged and tried again the next hour.
 */
export function startDailyBackup(env = process.env) {
  try {
    getDb(env);
  } catch (err) {
    console.error(`[storage] no database at ${dataDir(env)} (${err.message}). Set DATA_DIR to a folder this server can write to.`);
    return false;
  }
  const run = () => {
    try {
      const written = backupDb(getDb(env), backupDir(env));
      if (written) console.log(`[backup] wrote ${written}`);
    } catch (err) {
      console.error(`[backup] failed: ${err.message}`);
    }
  };
  run();
  setInterval(run, HOUR_MS).unref();
  return true;
}
