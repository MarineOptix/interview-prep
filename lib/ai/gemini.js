/**
 * Google Gemini through the Interactions API. Listens to audio itself, so no separate speech recognition is needed.
 * Every request carries `store: false`: by default Google keeps each interaction (55 days on the paid tier).
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

export const KEY = 'GEMINI_API_KEY';
export const HEARS_AUDIO = true;

export const DEFAULTS = {
  turn: 'gemini-3.5-flash-lite',
  plan: 'gemini-3.8-flash',
  report: 'gemini-3.8-flash',
  tts: 'gemini-3.8-flash-lite-tts',
  voice: 'Kore',
};

/** GEMINI_BASE_URL lets requests go through another address; empty means Google directly. */
export function interactionsUrl(env = process.env) {
  return `${(env.GEMINI_BASE_URL || GEMINI_BASE).replace(/\/+$/, '')}/v1beta/interactions`;
}

export function authHeaders(env = process.env) {
  return { 'x-goog-api-key': env[KEY] };
}

/** Text of the model's answer in an interaction (thought steps are ignored). */
export function outputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  return steps
    .filter((step) => step?.type === 'model_output' && Array.isArray(step.content))
    .flatMap((step) => step.content)
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('');
}

/** First audio item anywhere in an interaction, as { data, mimeType }, or null. */
export function findAudio(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (node.type === 'audio' && typeof node.data === 'string' && node.data) {
    return { data: node.data, mimeType: typeof node.mime_type === 'string' ? node.mime_type : 'audio/wav' };
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const found = findAudio(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Messages are provider-neutral: { role: 'system' | 'user' | 'assistant', content, audio?: { data, mimeType } }.
 * System messages become the system instruction; the rest become the conversation steps.
 */
export function buildRequest({ system, messages, schema, temperature, maxTokens }, model, env) {
  const instructions = [system, ...messages.filter((m) => m.role === 'system').map((m) => m.content)].filter(Boolean);
  const input = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      if (m.audio) content.push({ type: 'audio', data: m.audio.data, mime_type: m.audio.mimeType });
      return { type: m.role === 'assistant' ? 'model_output' : 'user_input', content };
    });

  const body = {
    model,
    input,
    response_format: { type: 'text', mime_type: 'application/json', ...(schema ? { schema } : {}) },
    store: false,
  };
  if (instructions.length) body.system_instruction = instructions.join('\n\n');
  const config = {};
  if (typeof temperature === 'number') config.temperature = temperature;
  if (typeof maxTokens === 'number') config.max_output_tokens = maxTokens;
  if (Object.keys(config).length) body.generation_config = config;

  return { url: interactionsUrl(env), headers: authHeaders(env), body };
}

export const readText = outputText;
