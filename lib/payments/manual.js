/**
 * The first payment provider: no online payment at all.
 * The owner issues codes from the console (scripts/codes.js); the price button leads to the "get early access" screen.
 */
export const name = 'manual';

export async function createPayment() {
  return { url: null };
}

export async function handleNotification() {
  return { ok: false, reason: 'not_supported' };
}
