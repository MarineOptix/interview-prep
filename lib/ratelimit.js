/**
 * Best-effort in-memory limiter for generation calls per IP per hour.
 * Resets on server restart, which is acceptable while the product is free and in validation.
 */
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map();

export function allowCall(ip, limit) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  const ok = recent.length < limit;
  if (ok) recent.push(now);
  hits.set(ip, recent);
  return ok;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) {
    if (!list.some((t) => now - t < WINDOW_MS)) hits.delete(ip);
  }
}, WINDOW_MS).unref();
