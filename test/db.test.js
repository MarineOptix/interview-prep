import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, dbFile, dataDir, storageStatus, transaction } from '../lib/db.js';
import { backupDb, listBackups } from '../lib/backup.js';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'passmuster-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const addCode = (db, code) => db.prepare("INSERT INTO access (code, total, source, created_at) VALUES (?, 3, 'promo', '2026-10-09T00:00:00.000Z')").run(code);

test('storage: the folder comes from DATA_DIR and defaults to /data', () => {
  assert.equal(dataDir({}), '/data');
  assert.equal(dbFile({ DATA_DIR: '/srv/passmuster' }), '/srv/passmuster/passmuster.db');
});

test('storage: a new database gets the three tables and nothing that could hold a conversation', () => {
  const db = openDb();
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  assert.deepEqual(columns('access'), ['code', 'service', 'total', 'used', 'expires_at', 'source', 'note', 'created_at']);
  assert.deepEqual(columns('sessions'), ['id', 'code', 'position', 'started_at', 'ended_at', 'turns', 'status']);
  assert.deepEqual(columns('payments'), ['id', 'provider', 'external_id', 'code', 'amount', 'currency', 'status', 'created_at']);
  assert.deepEqual(storageStatus(db).codes, 0);
});

test('storage: the file survives a restart and keeps its creation time', (t) => {
  const file = join(tempDir(t), 'passmuster.db');
  const first = openDb(file, new Date('2026-10-09T10:00:00Z'));
  addCode(first, 'PM-AAAAA-AAAAA');
  first.close();

  const second = openDb(file, new Date('2026-11-01T10:00:00Z'));
  assert.deepEqual(storageStatus(second), { createdAt: '2026-10-09T10:00:00.000Z', codes: 1, sessions: 0, payments: 0 });
  second.close();
});

test('storage: the database refuses impossible counters and unknown codes', () => {
  const db = openDb();
  addCode(db, 'PM-AAAAA-AAAAA');
  assert.throws(() => db.prepare("UPDATE access SET used = 4 WHERE code = 'PM-AAAAA-AAAAA'").run());
  assert.throws(() => db.prepare("INSERT INTO sessions (id, code, position, started_at) VALUES ('s1', 'PM-NOSUCH-CODE', 'second-engineer', 'now')").run());
  assert.throws(() => db.prepare("INSERT INTO access (code, total, source, created_at) VALUES ('X', 1, 'gift', 'now')").run());
});

test('storage: a failed transaction leaves nothing behind', () => {
  const db = openDb();
  assert.throws(() => transaction(db, () => {
    addCode(db, 'PM-AAAAA-AAAAA');
    throw new Error('stop');
  }), /stop/);
  assert.equal(storageStatus(db).codes, 0);
  assert.equal(transaction(db, () => { addCode(db, 'PM-BBBBB-BBBBB'); return 'done'; }), 'done');
  assert.equal(storageStatus(db).codes, 1);
});

test('backup: one copy a day, readable, and only the newest seven are kept', (t) => {
  const dir = tempDir(t);
  const db = openDb(join(dir, 'passmuster.db'));
  addCode(db, 'PM-AAAAA-AAAAA');
  const backups = join(dir, 'backup');

  assert.equal(backupDb(db, backups, new Date('2026-10-01T03:00:00Z')), 'passmuster-2026-10-01.db');
  assert.equal(backupDb(db, backups, new Date('2026-10-01T15:00:00Z')), null);
  const copy = openDb(join(backups, 'passmuster-2026-10-01.db'));
  assert.equal(storageStatus(copy).codes, 1);
  copy.close();

  // A stray file in the folder is not ours to remove.
  writeFileSync(join(backups, 'notes.txt'), 'keep me');
  for (let day = 2; day <= 9; day++) backupDb(db, backups, new Date(`2026-10-0${day}T03:00:00Z`));
  assert.deepEqual(listBackups(backups), [3, 4, 5, 6, 7, 8, 9].map((d) => `passmuster-2026-10-0${d}.db`));
  assert.deepEqual(readdirSync(backups).sort(), ['notes.txt', ...listBackups(backups)]);
  db.close();
});
