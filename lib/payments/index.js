/**
 * Payments, designed now and connected later.
 *
 * A payment provider is a module with two operations:
 *   createPayment(order, env)             -> { url }   where the buyer pays; null when there is no online payment
 *   handleNotification(db, request, env)  -> { ok, ... } checks the provider's signature, then calls applyPayment
 *
 * The product itself never asks "was this paid?". It only reads how many rehearsals a code has left (lib/access.js).
 */
import { transaction } from '../db.js';
import * as manual from './manual.js';

const PROVIDERS = { manual };

/** The provider named in PAYMENT_PROVIDER; 'manual' until online payment is connected. */
export function paymentProvider(env = process.env) {
  const provider = PROVIDERS[env.PAYMENT_PROVIDER || 'manual'];
  if (!provider) throw new Error(`Unknown payment provider: ${env.PAYMENT_PROVIDER}`);
  return provider;
}

/**
 * Records a confirmed payment and adds its rehearsals to the code. Every provider's handleNotification ends here.
 * A notification with a number already seen from that provider changes nothing: providers repeat notifications.
 * `amount` is in the smallest unit of the currency (cents).
 * Not decided yet, for the stage that connects payment: whether paying extends a code's end date. Today it does not.
 * Returns { ok: true, duplicate, remaining } or { ok: false, reason: 'unknown_code' }.
 */
export function applyPayment(db, { provider, externalId, code, amount, currency, rehearsals }, now = new Date()) {
  if (!provider || !externalId) throw new Error('a payment needs a provider and its external number');
  if (!Number.isInteger(rehearsals) || rehearsals < 1) throw new Error('rehearsals must be a whole number, 1 or more');
  if (!Number.isInteger(amount) || amount < 0) throw new Error('amount must be a whole number of the smallest currency unit');

  return transaction(db, () => {
    const remaining = () => {
      const row = db.prepare('SELECT total - used AS left FROM access WHERE code = ?').get(code);
      return row ? row.left : null;
    };
    if (remaining() === null) return { ok: false, reason: 'unknown_code' };

    const inserted = db
      .prepare("INSERT INTO payments (provider, external_id, code, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, 'paid', ?) ON CONFLICT (provider, external_id) DO NOTHING")
      .run(provider, String(externalId), code, amount, String(currency).toUpperCase(), now.toISOString()).changes;
    if (!inserted) return { ok: true, duplicate: true, remaining: remaining() };

    db.prepare('UPDATE access SET total = total + ? WHERE code = ?').run(rehearsals, code);
    return { ok: true, duplicate: false, remaining: remaining() };
  });
}
