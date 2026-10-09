/** Gemini speech synthesis: one phrase in, one audio clip out. */
import { DEFAULTS, authHeaders, findAudio, interactionsUrl } from './gemini.js';
import { LlmError, describe, postJson, retryable } from './http.js';

/** Returns { audio: Buffer, mimeType }. Retries once on network errors and 5xx; throws LlmError otherwise. */
export async function synthesizeGemini(text, env = process.env, fetchImpl = fetch) {
  const model = env.GEMINI_TTS_MODEL || DEFAULTS.tts;
  const body = {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: env.GEMINI_VOICE || DEFAULTS.voice }] },
    store: false,
  };

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = await postJson({ url: interactionsUrl(env), headers: authHeaders(env), body, timeoutMs: 20_000 }, fetchImpl);
      const found = findAudio(data);
      if (!found) throw new Error('no audio in the answer');
      return { audio: Buffer.from(found.data, 'base64'), mimeType: found.mimeType };
    } catch (err) {
      lastError = err;
      console.error(`[speech] gemini ${model}, attempt ${attempt}: ${describe(err)}`);
      if (!retryable(err)) break;
    }
  }
  throw lastError instanceof LlmError ? lastError : new LlmError('Speech synthesis failed.');
}
