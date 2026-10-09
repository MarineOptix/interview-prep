/**
 * Access by code, without accounts. The product checks how many rehearsals a code has left, not whether somebody paid:
 * payment, when it arrives, is one more way to add rehearsals to a code.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { transaction } from './db.js';

/** A rehearsal is taken off the code when the third answer arrives, so a failed microphone check costs nothing. */
export const CHARGE_AFTER_TURNS = 3;

/** Free starts are for trouble with the microphone, not for an endless supply of two-answer rehearsals. */
export const FREE_STARTS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SOURCES = ['free', 'promo', 'payment', 'invoice'];
export const SERVICES = ['rehearsal', 'assessment'];

// No 0/O or 1/I: codes are read off a screen and typed on a phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = /^PM-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

function newCode() {
  const part = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `PM-${part()}-${part()}`;
}

/** Accepts a code typed in any case, with or without the dashes and spaces. Returns the stored form, or '' if it cannot be a code. */
export function normaliseCode(input) {
  if (typeof input !== 'string') return '';
  const typed = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // The "PM" prefix may be left out; the ten characters after it may themselves start with "PM".
  const bare = typed.length === 12 && typed.startsWith('PM') ? typed.slice(2) : typed;
  const code = `PM-${bare.slice(0, 5)}-${bare.slice(5)}`;
  return CODE.test(code) ? code : '';
}

/**
 * Issues `count` codes with `rehearsals` rehearsals each. `days` is how long they stay valid; null means no end date.
 * Returns the new codes.
 */
export function createCodes(db, { count = 1, rehearsals = 1, days = null, source = 'promo', service = 'rehearsal', note = '' } = {}, now = new Date()) {
  const whole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!whole(count, 1, 1000)) throw new Error('count must be a whole number from 1 to 1000');
  if (!whole(rehearsals, 1, 1000)) throw new Error('rehearsals must be a whole number from 1 to 1000');
  if (days !== null && !whole(days, 1, 3650)) throw new Error('days must be a whole number from 1 to 3650');
  if (!SOURCES.includes(source)) throw new Error(`source must be one of: ${SOURCES.join(', ')}`);
  if (!SERVICES.includes(service)) throw new Error(`service must be one of: ${SERVICES.join(', ')}`);

  const expiresAt = days === null ? null : new Date(now.getTime() + days * DAY_MS).toISOString();
  const insert = db.prepare('INSERT INTO access (code, service, total, expires_at, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (code) DO NOTHING');
  return transaction(db, () => {
    const codes = [];
    while (codes.length < count) {
      const code = newCode();
      // A clash with an existing code is ignored by the insert and simply drawn again.
      if (insert.run(code, service, rehearsals, expiresAt, source, String(note).slice(0, 200), now.toISOString()).changes) codes.push(code);
    }
    return codes;
  });
}

/**
 * Looks a code up. Returns { ok: true, code, remaining, expiresAt },
 * or { ok: false, reason } where reason is 'unknown', 'expired' or 'used_up'.
 */
export function checkCode(db, input, now = new Date(), service = 'rehearsal') {
  const code = normaliseCode(input);
  const row = code ? db.prepare('SELECT * FROM access WHERE code = ? AND service = ?').get(code, service) : null;
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.expires_at && row.expires_at <= now.toISOString()) return { ok: false, reason: 'expired' };
  if (row.used >= row.total) return { ok: false, reason: 'used_up' };
  return { ok: true, code, remaining: row.total - row.used, expiresAt: row.expires_at };
}

/**
 * Starts a rehearsal for a valid code. Nothing is taken off the code yet.
 * Returns { ok: true, sessionId, remaining }, the refusal from checkCode, or { ok: false, reason: 'too_many_starts' }
 * when the code already has FREE_STARTS_PER_DAY rehearsals in the last 24 hours that stopped before the third answer.
 */
export function startSession(db, input, position, now = new Date()) {
  const access = checkCode(db, input, now);
  if (!access.ok) return access;
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const { n: freeStarts } = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE code = ? AND started_at > ? AND turns < ?').get(access.code, since, CHARGE_AFTER_TURNS);
  if (freeStarts >= FREE_STARTS_PER_DAY) return { ok: false, reason: 'too_many_starts' };
  const sessionId = randomUUID();
  db.prepare('INSERT INTO sessions (id, code, position, started_at) VALUES (?, ?, ?, ?)').run(sessionId, access.code, String(position).slice(0, 80), now.toISOString());
  return { ok: true, sessionId, remaining: access.remaining };
}

/**
 * Counts one answer. The third answer takes a rehearsal off the code; if the code has none left by then, the answer is refused.
 * Returns { ok: true, turns, charged } or { ok: false, reason } where reason is 'unknown_session', 'closed' or 'used_up'.
 */
export function recordTurn(db, sessionId) {
  return transaction(db, () => {
    const session = typeof sessionId === 'string' ? db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) : null;
    if (!session) return { ok: false, reason: 'unknown_session' };
    if (session.status === 'finished') return { ok: false, reason: 'closed' };

    const turns = session.turns + 1;
    let status = session.status;
    if (status === 'started' && turns >= CHARGE_AFTER_TURNS) {
      const charged = db.prepare('UPDATE access SET used = used + 1 WHERE code = ? AND used < total').run(session.code).changes;
      if (!charged) return { ok: false, reason: 'used_up' };
      status = 'charged';
    }
    db.prepare('UPDATE sessions SET turns = ?, status = ? WHERE id = ?').run(turns, status, sessionId);
    return { ok: true, turns, charged: status === 'charged' };
  });
}

/** Closes a rehearsal. Returns { ok } ; closing twice or closing an unknown session changes nothing. */
export function finishSession(db, sessionId, now = new Date()) {
  const done = db.prepare("UPDATE sessions SET status = 'finished', ended_at = ? WHERE id = ? AND status != 'finished'").run(now.toISOString(), String(sessionId)).changes;
  return { ok: done === 1 };
}

/** Codes with their counters, newest first, for the owner's console. */
export function listCodes(db) {
  return db.prepare('SELECT code, service, total, used, expires_at AS expiresAt, source, note, created_at AS createdAt FROM access ORDER BY created_at DESC, code').all();
}
