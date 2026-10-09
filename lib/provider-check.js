/**
 * Can this server reach the AI providers the rehearsal needs?
 * Five calls: Gemini text with JSON output, Gemini speech synthesis, Gemini audio input,
 * a short Gemini conversation through the model layer, and Groq text.
 * Used by `npm run check:providers` and by the token-protected page /check-providers.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { DEFAULTS as GEMINI_DEFAULTS, interactionsUrl, outputText, findAudio } from './ai/gemini.js';
import { DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from './ai/groq.js';
import { askJson } from './ai/llm.js';
import { describe } from './ai/http.js';

export { outputText, findAudio };

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 30_000;
const PHRASE = 'Good morning. Please tell me about your last vessel.';

export const DEFAULTS = {
  textModel: GEMINI_DEFAULTS.turn,
  ttsModel: GEMINI_DEFAULTS.tts,
  voice: GEMINI_DEFAULTS.voice,
  groqModel: GROQ_DEFAULT_MODEL,
};

const TITLES = {
  'gemini-text': 'Gemini: text with JSON output',
  'gemini-tts': 'Gemini: speech synthesis',
  'gemini-audio': 'Gemini: audio input',
  'gemini-dialogue': 'Gemini: conversation through the model layer',
  'groq-text': 'Groq: text',
};

/** One second of a 440 Hz tone as a 16 kHz mono 16-bit WAV file. Stands in when no speech is available. */
export function wavTone() {
  const rate = 16000;
  const samples = rate;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0, 'latin1');
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVE', 8, 'latin1');
  wav.write('fmt ', 12, 'latin1');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'latin1');
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return wav;
}

/** True when the check page is enabled (CHECK_TOKEN of 16+ characters) and the given token equals it. */
export function tokenMatches(given, env = process.env) {
  const expected = env.CHECK_TOKEN;
  if (typeof expected !== 'string' || expected.length < 16 || typeof given !== 'string' || !given) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Runs the four calls one after another. Never throws; keys never appear in the report. */
export async function runChecks(env = process.env, fetchImpl = fetch) {
  const secrets = [env.GEMINI_API_KEY, env.GROQ_API_KEY].filter(Boolean);
  const clean = (text) => secrets.reduce((out, secret) => out.split(secret).join('***'), String(text)).replace(/\s+/g, ' ').trim().slice(0, 300);

  const textModel = env.GEMINI_MODEL || DEFAULTS.textModel;
  const ttsModel = env.GEMINI_TTS_MODEL || DEFAULTS.ttsModel;
  const voice = env.GEMINI_VOICE || DEFAULTS.voice;

  /** Sends one request and turns the outcome into a result row. `judge` gets the parsed JSON body. */
  async function call(id, url, headers, body, judge) {
    const started = Date.now();
    const row = { id, title: TITLES[id], ok: false, skipped: false, ms: 0, status: 0, detail: '' };
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      row.status = res.status;
      const raw = await res.text();
      if (!res.ok) {
        row.detail = clean(`HTTP ${res.status}: ${raw}`);
      } else {
        const verdict = judge(parseJsonText(raw) ?? {});
        row.ok = verdict.ok;
        row.detail = clean(verdict.detail);
        row.value = verdict.value;
      }
    } catch (err) {
      // The cause carries the useful part (ECONNREFUSED, ETIMEDOUT, a TLS or proxy message).
      const parts = [err?.message || String(err), err?.cause?.code, err?.cause?.message].filter(Boolean);
      row.detail = clean(`No answer: ${[...new Set(parts)].join(' | ')}`);
    }
    row.ms = Date.now() - started;
    return row;
  }

  const skip = (id, why) => ({ id, title: TITLES[id], ok: false, skipped: true, ms: 0, status: 0, detail: why });
  const gemini = (id, body, judge) => call(id, interactionsUrl(env), { 'x-goog-api-key': env.GEMINI_API_KEY }, { ...body, store: false }, judge);

  const results = [];
  if (!env.GEMINI_API_KEY) {
    for (const id of ['gemini-text', 'gemini-tts', 'gemini-audio', 'gemini-dialogue']) results.push(skip(id, 'GEMINI_API_KEY is not set.'));
  } else {
    results.push(await gemini('gemini-text', {
      model: textModel,
      input: 'Reply with a JSON object whose "status" is "ok".',
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] } },
    }, (data) => {
      const parsed = parseJsonText(outputText(data));
      return parsed && typeof parsed.status === 'string'
        ? { ok: true, detail: `Model ${textModel} answered with valid JSON.` }
        : { ok: false, detail: `The answer was not the expected JSON: ${outputText(data) || JSON.stringify(data)}` };
    }));

    const tts = await gemini('gemini-tts', {
      model: ttsModel,
      input: [{ type: 'user_input', content: [{ type: 'text', text: PHRASE }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }, (data) => {
      const audio = findAudio(data);
      const bytes = audio ? Buffer.from(audio.data, 'base64').length : 0;
      return bytes > 1000
        ? { ok: true, detail: `Model ${ttsModel}, voice ${voice}: ${bytes} bytes of ${audio.mimeType}.`, value: audio }
        : { ok: false, detail: `No audio in the answer: ${JSON.stringify(data)}` };
    });
    const spoken = tts.value;
    delete tts.value;
    results.push(tts);

    // Listen to the speech just produced; if there is none, a tone still shows whether audio input is accepted.
    const clip = spoken ?? { data: wavTone().toString('base64'), mimeType: 'audio/wav' };
    results.push(await gemini('gemini-audio', {
      model: textModel,
      input: [
        { type: 'text', text: 'Transcribe the speech in this audio clip. If there is no speech, use an empty string.' },
        { type: 'audio', data: clip.data, mime_type: clip.mimeType },
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object', properties: { transcript: { type: 'string' } }, required: ['transcript'] } },
    }, (data) => {
      const parsed = parseJsonText(outputText(data));
      if (!parsed || typeof parsed.transcript !== 'string') return { ok: false, detail: `The answer was not the expected JSON: ${outputText(data) || JSON.stringify(data)}` };
      if (!spoken) return { ok: true, detail: 'Audio input accepted (sent a test tone, because speech synthesis gave no audio).' };
      return /vessel/i.test(parsed.transcript)
        ? { ok: true, detail: `Heard: "${parsed.transcript}"` }
        : { ok: false, detail: `The transcript does not match the spoken phrase: "${parsed.transcript}"` };
    }));

    // The same path a rehearsal turn takes: system instruction, earlier turns, a schema and generation settings.
    const started = Date.now();
    const row = { id: 'gemini-dialogue', title: TITLES['gemini-dialogue'], ok: false, skipped: false, ms: 0, status: 0, detail: '' };
    try {
      const answer = await askJson({
        use: 'turn',
        system: 'You are a connection test. Answer with JSON only.',
        messages: [
          { role: 'user', content: 'My last vessel was called Aurora.' },
          { role: 'assistant', content: '{"answer":"Noted."}' },
          { role: 'user', content: 'What was my last vessel called?' },
        ],
        schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
        validate: (parsed) => {
          if (typeof parsed?.answer !== 'string') throw new Error('no answer field');
          return parsed.answer;
        },
        temperature: 0,
        maxTokens: 300,
      }, env, fetchImpl);
      row.ok = /aurora/i.test(answer);
      row.status = 200;
      row.detail = clean(row.ok ? `Model ${textModel} used the earlier turns: "${answer}"` : `The model did not use the earlier turns: "${answer}"`);
    } catch (err) {
      // On an HTTP error the model layer attaches the provider's own error text.
      row.status = err?.httpStatus ?? 0;
      row.detail = clean(describe(err?.cause ?? err));
    }
    row.ms = Date.now() - started;
    results.push(row);
  }

  if (!env.GROQ_API_KEY) {
    results.push(skip('groq-text', 'GROQ_API_KEY is not set.'));
  } else {
    const groqModel = env.GROQ_MODEL || DEFAULTS.groqModel;
    results.push(await call('groq-text', GROQ_URL, { Authorization: `Bearer ${env.GROQ_API_KEY}` }, {
      model: groqModel,
      messages: [{ role: 'user', content: 'Reply with a JSON object whose "status" is "ok".' }],
      max_completion_tokens: 200,
      response_format: { type: 'json_object' },
    }, (data) => {
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === 'string' && content
        ? { ok: true, detail: `Model ${groqModel} answered.` }
        : { ok: false, detail: `Empty answer: ${JSON.stringify(data)}` };
    }));
  }

  for (const row of results) delete row.value;
  // The check passes on the Gemini calls; Groq only decides where the text plan runs.
  const ok = results.filter((r) => r.id.startsWith('gemini-')).every((r) => r.ok);
  return { ok, checkedAt: new Date().toISOString(), results };
}
