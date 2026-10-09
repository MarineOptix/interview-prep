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
 * Posts JSON and returns the parsed answer.
 * Throws LlmError 503 when a retry will not help (429 and other 4xx), LlmError 502 on 5xx, and the plain error on network failure.
 * Provider error text goes to the server log only; the visitor gets a plain message.
 */
export async function postJson({ url, headers, body, label, timeoutMs = 28_000 }, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) {
    console.error(`[${label}] 429 for model ${body.model}`);
    throw new LlmError(BUSY, 503);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    const err = new LlmError(res.status < 500 ? UNAVAILABLE : 'The AI service had a problem. Try again.', res.status < 500 ? 503 : 502);
    err.httpStatus = res.status;
    err.detail = detail;
    throw err;
  }
  return res.json();
}

/** True when a second attempt may succeed: network failures, timeouts, 5xx and answers that failed validation. */
export function retryable(err) {
  return !(err instanceof LlmError && err.status === 503);
}
