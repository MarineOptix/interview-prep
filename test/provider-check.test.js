import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../lib/db.js';
import { runChecks, runLatencyProbe, outputText, findAudio, wavTone, tokenMatches } from '../lib/provider-check.js';

const GEMINI_KEY = 'secret-gemini-key';
const GROQ_KEY = 'secret-groq-key';
const SPOKEN = Buffer.alloc(2000, 7).toString('base64');

const interaction = (content) => Response.json({ id: 'i1', status: 'completed', steps: [{ type: 'model_output', content }] });

/** A fake fetch that answers like the providers do and records every request. */
function fakeProviders({ tts = 'ok', leakKey = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), headers: opts.headers, body });
    if (String(url).includes('groq.com')) return Response.json({ choices: [{ message: { content: '{"status":"ok"}' } }] });
    if (body.model.includes('tts')) {
      if (tts === 'fail') return new Response(`{"error":{"message":"voice not found${leakKey ? ` for key ${GEMINI_KEY}` : ''}"}}`, { status: 400 });
      return interaction([{ type: 'audio', mime_type: 'audio/wav', data: SPOKEN }]);
    }
    if (Array.isArray(body.input) && body.input.some((item) => item.type === 'model_output')) return interaction([{ type: 'text', text: '{"answer":"Your last vessel was Aurora."}' }]);
    const hasAudio = Array.isArray(body.input) && body.input.some((item) => item.type === 'audio');
    if (hasAudio) return interaction([{ type: 'text', text: '{"transcript":"Good morning. Please tell me about your last vessel."}' }]);
    return interaction([{ type: 'text', text: '{"status":"ok"}' }]);
  };
  return { calls, fetchImpl };
}

const env = { GEMINI_API_KEY: GEMINI_KEY, GROQ_API_KEY: GROQ_KEY };
const byId = (report, id) => report.results.find((r) => r.id === id);

test('provider check: reads text and audio out of an interaction', () => {
  const data = { steps: [{ type: 'thought', content: [{ type: 'text', text: 'hidden' }] }, { type: 'model_output', content: [{ type: 'text', text: 'Hello' }, { type: 'audio', mime_type: 'audio/wav', data: SPOKEN }] }] };
  assert.equal(outputText(data), 'Hello');
  assert.deepEqual(findAudio(data), { data: SPOKEN, mimeType: 'audio/wav' });
  assert.equal(outputText({ output_text: 'Flat' }), 'Flat');
  assert.equal(outputText({}), '');
  assert.equal(findAudio({ steps: [] }), null);
});

test('provider check: all five calls pass and nothing is stored at Google', async () => {
  const { calls, fetchImpl } = fakeProviders();
  const report = await runChecks(env, fetchImpl);
  assert.equal(report.ok, true);
  assert.deepEqual(report.results.map((r) => [r.id, r.ok]), [['gemini-text', true], ['gemini-tts', true], ['gemini-audio', true], ['gemini-dialogue', true], ['groq-text', true]]);
  const gemini = calls.filter((c) => c.url.includes('/v1beta/interactions'));
  assert.equal(gemini.length, 4);
  for (const call of gemini) {
    assert.equal(call.body.store, false);
    assert.equal(call.headers['x-goog-api-key'], GEMINI_KEY);
  }
  // The audio check listens to the speech the TTS check produced.
  const heard = gemini[2].body.input.find((item) => item.type === 'audio');
  assert.equal(heard.data, SPOKEN);
  assert.equal(byId(report, 'gemini-audio').detail.includes('vessel'), true);
  // The conversation check goes through the model layer: system instruction, earlier turns as steps, a schema.
  const dialogue = gemini[3].body;
  assert.equal(typeof dialogue.system_instruction, 'string');
  assert.deepEqual(dialogue.input.map((step) => step.type), ['user_input', 'model_output', 'user_input']);
  assert.equal(dialogue.response_format.schema.required[0], 'answer');
  assert.match(byId(report, 'gemini-dialogue').detail, /Aurora/);
  assert.equal(JSON.stringify(report).includes(GEMINI_KEY), false);
  assert.equal(JSON.stringify(report).includes(GROQ_KEY), false);
});

test('provider check: a failed speech call is reported and audio input is still tried with a tone', async () => {
  const { calls, fetchImpl } = fakeProviders({ tts: 'fail', leakKey: true });
  const report = await runChecks(env, fetchImpl);
  assert.equal(report.ok, false);
  const tts = byId(report, 'gemini-tts');
  assert.equal(tts.ok, false);
  assert.equal(tts.status, 400);
  assert.match(tts.detail, /voice not found/);
  assert.equal(tts.detail.includes(GEMINI_KEY), false);
  const audio = byId(report, 'gemini-audio');
  assert.equal(audio.ok, true);
  assert.match(audio.detail, /tone/);
  const sent = calls[2].body.input.find((item) => item.type === 'audio');
  assert.equal(Buffer.from(sent.data, 'base64').subarray(0, 4).toString('latin1'), 'RIFF');
});

test('provider check: without keys nothing is called and every check is skipped', async () => {
  const { calls, fetchImpl } = fakeProviders();
  const report = await runChecks({}, fetchImpl);
  assert.equal(calls.length, 0);
  assert.equal(report.ok, false);
  assert.equal(report.results.length, 5);
  assert.equal(report.results.every((r) => r.skipped && !r.ok), true);
});

test('provider check: a network error becomes a failed result, not a crash', async () => {
  const report = await runChecks(env, async () => { throw new Error('connect ETIMEDOUT'); });
  assert.equal(report.ok, false);
  assert.match(byId(report, 'gemini-text').detail, /ETIMEDOUT/);
});

test('provider check: the base address and models come from the environment', async () => {
  const { calls, fetchImpl } = fakeProviders();
  await runChecks({ ...env, GEMINI_BASE_URL: 'https://proxy.example/', GEMINI_MODEL: 'gemini-x', GEMINI_TTS_MODEL: 'gemini-x-tts' }, fetchImpl);
  assert.equal(calls[0].url, 'https://proxy.example/v1beta/interactions');
  assert.equal(calls[0].body.model, 'gemini-x');
  assert.equal(calls[1].body.model, 'gemini-x-tts');
});

test('provider check: the tone is a valid one-second WAV file', () => {
  const wav = wavTone();
  assert.equal(wav.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('latin1'), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.length, 44 + 16000 * 2);
});

test('provider check: the token must be set, long enough and equal', () => {
  const token = 'a'.repeat(24);
  assert.equal(tokenMatches(token, { CHECK_TOKEN: token }), true);
  assert.equal(tokenMatches('wrong', { CHECK_TOKEN: token }), false);
  assert.equal(tokenMatches('', { CHECK_TOKEN: token }), false);
  assert.equal(tokenMatches(token, {}), false);
  assert.equal(tokenMatches('short', { CHECK_TOKEN: 'short' }), false);
});

test('latency probe: five timed calls, none stored, with the token counts Google reports', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ headers: opts.headers, body });
    if (body.generation_config?.thinking_level) return new Response(`{"error":{"message":"thinking_level is not supported for key ${GEMINI_KEY}"}}`, { status: 400 });
    return Response.json({ steps: [], usage: { total_input_tokens: 12, total_output_tokens: 5, total_thought_tokens: 40 } });
  };
  const probe = await runLatencyProbe({ GEMINI_API_KEY: GEMINI_KEY, GEMINI_PLAN_MODEL: 'gemini-plan-x' }, fetchImpl);

  assert.deepEqual(probe.results.map((row) => row.id), ['turn-model-plain', 'turn-model-json', 'plan-model-default', 'plan-model-low-thinking', 'turn-model-json-again']);
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.body.store, false);
    assert.equal(call.headers['x-goog-api-key'], GEMINI_KEY);
  }
  assert.deepEqual(probe.results[0].tokens, { input: 12, output: 5, thought: 40 });
  assert.equal(probe.results[2].model, 'gemini-plan-x');
  const refused = probe.results[3];
  assert.deepEqual([refused.ok, refused.status], [false, 400]);
  assert.match(refused.detail, /thinking_level is not supported/);
  assert.equal(probe.ok, false);
  assert.equal(JSON.stringify(probe).includes(GEMINI_KEY), false);

  const without = await runLatencyProbe({}, fetchImpl);
  assert.deepEqual([without.ok, without.results.length, calls.length], [false, 0, 5]);
});

/** Calls the app the way the HTTP server does and collects the response. */
async function request(url) {
  const { default: handle } = await import('../lib/app.js');
  const out = { status: 0, headers: {}, body: '' };
  const res = { headersSent: false, writeHead(status, headers) { out.status = status; out.headers = headers; this.headersSent = true; }, end(body) { out.body = String(body ?? ''); } };
  await handle({ method: 'GET', url, headers: {}, socket: {} }, res);
  return out;
}

test('check page: hidden unless the token is configured and matches; runs once per cooldown', async () => {
  const saved = { ...process.env };
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.CHECK_TOKEN;
  const dataDir = mkdtempSync(join(tmpdir(), 'passmuster-check-'));
  process.env.DATA_DIR = dataDir;
  try {
    assert.equal((await request('/check-providers?token=anything')).status, 404);
    process.env.CHECK_TOKEN = 'b'.repeat(24);
    assert.equal((await request('/check-providers')).status, 404);
    assert.equal((await request('/check-providers?token=wrong')).status, 404);
    const ok = await request(`/check-providers?token=${'b'.repeat(24)}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['Cache-Control'], 'no-store');
    const report = JSON.parse(ok.body);
    assert.equal(report.results.length, 5);
    assert.equal(report.results.every((r) => r.skipped), true);
    // The page also says whether the database of access codes opens, without showing any code.
    assert.equal(report.storage.ok, true);
    assert.deepEqual([report.storage.codes, report.storage.sessions, report.storage.backups], [0, 0, 0]);
    assert.match(report.storage.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((await request(`/check-providers?token=${'b'.repeat(24)}`)).status, 429);
  } finally {
    closeDb();
    rmSync(dataDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
