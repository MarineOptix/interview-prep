import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { createCodes, checkCode, startSession, recordTurn, finishSession, normaliseCode, listCodes, CHARGE_AFTER_TURNS } from '../lib/access.js';
import { applyPayment, paymentProvider } from '../lib/payments/index.js';

const NOW = new Date('2026-10-09T12:00:00Z');
const daysLater = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const used = (db, code) => db.prepare('SELECT used FROM access WHERE code = ?').get(code).used;

/** Answers `n` times in a session and returns the last result. */
function answer(db, sessionId, n) {
  let last;
  for (let i = 0; i < n; i++) last = recordTurn(db, sessionId);
  return last;
}

test('access: codes are unique, easy to type and accepted however they are typed', () => {
  const db = openDb();
  const codes = createCodes(db, { count: 50, rehearsals: 3 }, NOW);
  assert.equal(new Set(codes).size, 50);
  for (const code of codes) assert.match(code, /^PM-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);

  const [code] = codes;
  const bare = code.replaceAll('-', '');
  assert.equal(normaliseCode(code.toLowerCase()), code);
  assert.equal(normaliseCode(`  ${bare.slice(0, 2)} ${bare.slice(2, 7)} ${bare.slice(7)} `), code);
  assert.equal(normaliseCode(bare.slice(2)), code);
  assert.equal(normaliseCode('PM-PMABC-DEFGH'), 'PM-PMABC-DEFGH');
  assert.equal(normaliseCode('PM-ABCDE'), '');
  assert.equal(normaliseCode("x' OR '1'='1"), '');
  assert.equal(normaliseCode(undefined), '');
  assert.equal(checkCode(db, code.toLowerCase(), NOW).remaining, 3);
});

test('access: issuing codes rejects nonsense', () => {
  const db = openDb();
  assert.throws(() => createCodes(db, { count: 0 }), /count/);
  assert.throws(() => createCodes(db, { rehearsals: 1.5 }), /rehearsals/);
  assert.throws(() => createCodes(db, { days: -1 }), /days/);
  assert.throws(() => createCodes(db, { source: 'gift' }), /source/);
  assert.equal(listCodes(db).length, 0);
});

test('access: an unknown code, an expired code and a used-up code are refused', () => {
  const db = openDb();
  assert.deepEqual(checkCode(db, 'PM-AAAAA-AAAAA', NOW), { ok: false, reason: 'unknown' });
  assert.deepEqual(startSession(db, 'not a code', 'second-engineer', NOW), { ok: false, reason: 'unknown' });

  const [dated] = createCodes(db, { rehearsals: 1, days: 30 }, NOW);
  assert.equal(checkCode(db, dated, daysLater(29)).ok, true);
  assert.deepEqual(checkCode(db, dated, daysLater(30)), { ok: false, reason: 'expired' });
  assert.deepEqual(startSession(db, dated, 'second-engineer', daysLater(31)), { ok: false, reason: 'expired' });

  const [single] = createCodes(db, { rehearsals: 1 }, NOW);
  const { sessionId } = startSession(db, single, 'second-engineer', NOW);
  answer(db, sessionId, CHARGE_AFTER_TURNS);
  assert.deepEqual(checkCode(db, single, NOW), { ok: false, reason: 'used_up' });
  assert.deepEqual(startSession(db, single, 'second-engineer', NOW), { ok: false, reason: 'used_up' });

  // A code for the crewing-agency service does not open a rehearsal.
  const [agency] = createCodes(db, { service: 'assessment' }, NOW);
  assert.deepEqual(checkCode(db, agency, NOW), { ok: false, reason: 'unknown' });
});

test('access: a rehearsal is taken off the code on the third answer, once', () => {
  const db = openDb();
  const [code] = createCodes(db, { rehearsals: 3 }, NOW);
  const started = startSession(db, code, 'chief-engineer', NOW);
  assert.equal(started.remaining, 3);
  assert.equal(used(db, code), 0);

  assert.deepEqual(recordTurn(db, started.sessionId), { ok: true, turns: 1, charged: false });
  assert.deepEqual(recordTurn(db, started.sessionId), { ok: true, turns: 2, charged: false });
  assert.equal(used(db, code), 0);
  assert.deepEqual(recordTurn(db, started.sessionId), { ok: true, turns: 3, charged: true });
  assert.equal(used(db, code), 1);

  assert.deepEqual(answer(db, started.sessionId, 17), { ok: true, turns: 20, charged: true });
  assert.equal(used(db, code), 1);
  assert.equal(checkCode(db, code, NOW).remaining, 2);
});

test('access: a rehearsal that stops before the third answer costs nothing', () => {
  const db = openDb();
  const [code] = createCodes(db, { rehearsals: 1 }, NOW);
  const { sessionId } = startSession(db, code, 'second-engineer', NOW);
  answer(db, sessionId, 2);
  assert.deepEqual(finishSession(db, sessionId, NOW), { ok: true });
  assert.equal(used(db, code), 0);
  assert.equal(checkCode(db, code, NOW).remaining, 1);
});

test('access: two rehearsals on a code with one left cannot both pass the third answer', () => {
  const db = openDb();
  const [code] = createCodes(db, { rehearsals: 1 }, NOW);
  const first = startSession(db, code, 'second-engineer', NOW);
  const second = startSession(db, code, 'second-engineer', NOW);
  answer(db, first.sessionId, 2);
  answer(db, second.sessionId, 2);

  assert.equal(recordTurn(db, first.sessionId).charged, true);
  assert.deepEqual(recordTurn(db, second.sessionId), { ok: false, reason: 'used_up' });
  assert.equal(used(db, code), 1);
  // The refused answer was not counted, and the paid rehearsal goes on.
  assert.equal(db.prepare('SELECT turns FROM sessions WHERE id = ?').get(second.sessionId).turns, 2);
  assert.equal(recordTurn(db, first.sessionId).turns, 4);
});

test('access: a finished or unknown rehearsal takes no more answers', () => {
  const db = openDb();
  const [code] = createCodes(db, { rehearsals: 2 }, NOW);
  const { sessionId } = startSession(db, code, 'second-engineer', NOW);
  answer(db, sessionId, 5);
  assert.deepEqual(finishSession(db, sessionId, daysLater(0)), { ok: true });
  assert.deepEqual(finishSession(db, sessionId, NOW), { ok: false });
  assert.deepEqual(recordTurn(db, sessionId), { ok: false, reason: 'closed' });
  assert.deepEqual(recordTurn(db, 'no-such-session'), { ok: false, reason: 'unknown_session' });
  assert.deepEqual(recordTurn(db, undefined), { ok: false, reason: 'unknown_session' });

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  assert.deepEqual({ ...row }, { id: sessionId, code, position: 'second-engineer', started_at: NOW.toISOString(), ended_at: NOW.toISOString(), turns: 5, status: 'finished' });
});

test('payments: a payment adds rehearsals to the code, and a repeated notification changes nothing', () => {
  const db = openDb();
  const [code] = createCodes(db, { rehearsals: 1, source: 'payment' }, NOW);
  const payment = { provider: 'testpay', externalId: 'inv-1001', code, amount: 900, currency: 'usd', rehearsals: 3 };

  assert.deepEqual(applyPayment(db, payment, NOW), { ok: true, duplicate: false, remaining: 4 });
  assert.deepEqual(applyPayment(db, payment, NOW), { ok: true, duplicate: true, remaining: 4 });
  assert.deepEqual(applyPayment(db, { ...payment, rehearsals: 10 }, NOW), { ok: true, duplicate: true, remaining: 4 });
  assert.equal(checkCode(db, code, NOW).remaining, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 1);
  assert.equal(db.prepare('SELECT currency FROM payments').get().currency, 'USD');

  // The same number from another provider, or a new number, is a different payment.
  assert.equal(applyPayment(db, { ...payment, provider: 'otherpay' }, NOW).remaining, 7);
  assert.equal(applyPayment(db, { ...payment, externalId: 'inv-1002' }, NOW).remaining, 10);
});

test('payments: a payment for an unknown code is refused and nothing is recorded', () => {
  const db = openDb();
  assert.deepEqual(applyPayment(db, { provider: 'testpay', externalId: 'inv-1', code: 'PM-AAAAA-AAAAA', amount: 900, currency: 'USD', rehearsals: 3 }, NOW), { ok: false, reason: 'unknown_code' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 0);
  assert.throws(() => applyPayment(db, { provider: 'testpay', externalId: 'inv-2', code: 'x', amount: 9.5, currency: 'USD', rehearsals: 3 }), /amount/);
  assert.throws(() => applyPayment(db, { provider: 'testpay', externalId: 'inv-2', code: 'x', amount: 900, currency: 'USD', rehearsals: 0 }), /rehearsals/);
});

test('payments: the only provider for now is the manual one, with no online payment', async () => {
  const provider = paymentProvider({});
  assert.equal(provider.name, 'manual');
  assert.deepEqual(await provider.createPayment({ rehearsals: 3 }), { url: null });
  assert.deepEqual(await provider.handleNotification(), { ok: false, reason: 'not_supported' });
  assert.throws(() => paymentProvider({ PAYMENT_PROVIDER: 'nopay' }), /Unknown payment provider/);
});
