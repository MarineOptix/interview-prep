/**
 * One HTTP call to an AI provider, with the outcome sorted into "retry may help" and "it will not".
 * Shared by the model layer (llm.js) and the speech layer (gemini-tts.js).
 */

export class LlmError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export const UNAVAILABLE = 'The AI service is not available right now. Try again later.';
export const BUSY = 'The AI service is busy. Try again in a minute.';

/**
 * What a provider's error body may put in the server log: its error code and message, cut short, with our keys removed.
 * The rest of the body stays out: some providers echo the request or the model's half-written answer there.
 */
export function summarise(detail, secrets = []) {
  let text;
  try {
    const parsed = JSON.parse(detail);
    const error = parsed?.error ?? parsed;
    const parts = typeof error === 'string' ? [error] : [error?.status ?? error?.code ?? error?.type, error?.message];
    text = parts.filter((part) => typeof part === 'string' || typeof part === 'number').join(': ');
  } catch {
    text = '';
  }
  if (!text) return `error body of ${detail.length} characters, not shown`;
  return secrets.reduce((out, secret) => out.split(secret).join('***'), text).replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * Posts JSON and returns the parsed answer.
 * Throws LlmError 503 when a retry will not help (429 and other 4xx), LlmError 502 on 5xx, and the plain error on network failure.
 * On an HTTP error the thrown error carries `httpStatus`, the raw `detail` (for the caller's logic, never for the log) and a log-safe `summary`.
 */
export async function postJson({ url, headers, body, timeoutMs = 28_000 }, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    err.network = true;
    throw err;
  }
  if (res.ok) return res.json();

  const detail = (await res.text()).slice(0, 2000);
  const secrets = Object.values(headers).map((value) => String(value).replace(/^Bearer /, '')).filter((value) => value.length >= 8);
  const err =
    res.status === 429
      ? new LlmError(BUSY, 503)
      : new LlmError(res.status < 500 ? UNAVAILABLE : 'The AI service had a problem. Try again.', res.status < 500 ? 503 : 502);
  err.httpStatus = res.status;
  err.detail = detail;
  err.summary = summarise(detail, secrets);
  throw err;
}

/** True when a second attempt may succeed: network failures, timeouts, 5xx and answers that failed validation. */
export function retryable(err) {
  return !(err instanceof LlmError && err.status === 503);
}

/**
 * A log line for a failed attempt that cannot contain anything the candidate or the model said.
 * Parse and validation errors are named, not quoted: their messages can carry pieces of the answer.
 */
export function describe(err) {
  if (err?.httpStatus) return `HTTP ${err.httpStatus}: ${err.summary}`;
  if (err instanceof LlmError) return err.message;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'no answer in time';
  // A failed connection carries no request or answer text, so its own message is safe to show.
  if (err?.network) return `no connection: ${[err.cause?.code, err.message].filter(Boolean).join(', ')}`.slice(0, 200);
  return `the answer could not be used (${err?.name || 'Error'})`;
}
