/**
 * The model layer. The product calls one function, askJson, and does not know which provider answers.
 * Provider, model names, address and keys come from environment variables.
 */
import * as groq from './groq.js';
import * as gemini from './gemini.js';
import { LlmError, UNAVAILABLE, postJson, retryable } from './http.js';

export { LlmError };

const PROVIDERS = { groq, gemini };

/**
 * Which provider and model serve a kind of call.
 * 'text' is the written plan and document reading (Groq, or Gemini when TEXT_PROVIDER=gemini);
 * 'turn', 'plan' and 'report' are the three calls of a voice rehearsal (Gemini).
 */
export function resolve(use, env = process.env) {
  if (use === 'text') {
    return env.TEXT_PROVIDER === 'gemini'
      ? { provider: 'gemini', model: env.GEMINI_MODEL || gemini.DEFAULTS.turn }
      : { provider: 'groq', model: env.GROQ_MODEL || groq.DEFAULT_MODEL };
  }
  const override = { turn: env.GEMINI_MODEL, plan: env.GEMINI_PLAN_MODEL, report: env.GEMINI_REPORT_MODEL };
  if (!(use in override)) throw new Error(`Unknown kind of model call: ${use}`);
  return { provider: 'gemini', model: override[use] || gemini.DEFAULTS[use] };
}

/** Parses JSON from model output, tolerating code fences or text around the object. */
export function parseJson(content) {
  if (typeof content !== 'string') return {};
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('model output is not JSON');
    return JSON.parse(content.slice(start, end + 1));
  }
}

/**
 * Sends messages (and audio, if a message carries it) to the model and returns `validate(parsedJson)`.
 *
 * request: {
 *   use: 'text' | 'turn' | 'plan' | 'report',
 *   system?: string,
 *   messages: [{ role: 'system' | 'user' | 'assistant', content: string, audio?: { data: base64, mimeType } }],
 *   schema?: JSON schema of the answer (Gemini enforces it; Groq relies on the prompt),
 *   validate?: (parsed) => value, throws when the answer is not usable,
 *   temperature?, maxTokens?, timeoutMs?, failMessage?
 * }
 *
 * Retries once on network errors, 5xx and output that fails validation; never on 4xx.
 * Nothing from the messages or the answer is written to the log.
 */
export async function askJson(request, env = process.env, fetchImpl = fetch) {
  const { use = 'text', validate = (parsed) => parsed, failMessage, timeoutMs } = request;
  const { provider, model } = resolve(use, env);
  const impl = PROVIDERS[provider];

  if (!env[impl.KEY]) {
    console.error(`[llm] ${impl.KEY} is not set`);
    throw new LlmError(UNAVAILABLE, 503);
  }
  if (!impl.HEARS_AUDIO && request.messages.some((m) => m.audio)) {
    console.error(`[llm] ${provider} cannot take audio; '${use}' calls with audio need Gemini`);
    throw new LlmError(UNAVAILABLE, 503);
  }

  const { url, headers, body } = impl.buildRequest(request, model, env);

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = await postJson({ url, headers, body, label: 'llm', timeoutMs }, fetchImpl);
      return validate(parseJson(impl.readText(data)));
    } catch (err) {
      if (err.httpStatus && impl.relax?.(body, err.httpStatus, err.detail)) {
        console.error(`[llm] JSON mode rejected for ${model}, retrying without it: ${err.detail}`);
        attempt--;
        continue;
      }
      if (err.httpStatus) console.error(`[llm] ${provider} ${err.httpStatus} for model ${model}: ${err.detail}`);
      lastError = err;
      if (!retryable(err)) break;
      console.error(`[llm] attempt ${attempt} failed: ${err.message}`);
    }
  }
  throw lastError instanceof LlmError ? lastError : new LlmError(failMessage || 'The AI could not complete this. Try again.');
}
