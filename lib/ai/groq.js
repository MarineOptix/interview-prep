/** Groq (OpenAI-compatible chat completions). Text only: it does not listen to audio. */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const KEY = 'GROQ_API_KEY';
export const HEARS_AUDIO = false;

// llama-3.3-70b-versatile was decommissioned by Groq on 2026-08-16; gpt-oss-120b is Groq's recommended replacement.
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** Builds a Groq request body. Reasoning models get low effort so a call fits the time limit. */
export function buildBody(messages, model = DEFAULT_MODEL, { temperature = 0.4, maxTokens = 8000 } = {}) {
  const body = {
    model,
    messages,
    temperature,
    // Reasoning tokens count towards this limit on reasoning models, so it is generous.
    max_completion_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };
  if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
  return body;
}

export function buildRequest({ system, messages, temperature, maxTokens }, model, env) {
  const all = system ? [{ role: 'system', content: system }, ...messages] : messages;
  return {
    url: GROQ_URL,
    headers: { Authorization: `Bearer ${env[KEY]}` },
    body: buildBody(all.map(({ role, content }) => ({ role, content })), model, { temperature, maxTokens }),
  };
}

export function readText(data) {
  return data?.choices?.[0]?.message?.content;
}

/** If the model rejects JSON mode, drop it: the prompt already asks for JSON. Returns true when the body was changed. */
export function relax(body, httpStatus, detail) {
  if (httpStatus !== 400 || !body.response_format || !/response_format|json/i.test(detail ?? '')) return false;
  delete body.response_format;
  return true;
}
