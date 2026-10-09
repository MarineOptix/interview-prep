import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askJson, resolve, LlmError } from '../lib/ai/llm.js';
import { synthesize, speechMode } from '../lib/ai/speech.js';
import { summarise } from '../lib/ai/http.js';

const interaction = (content) => Response.json({ steps: [{ type: 'model_output', content }] });
const geminiText = (object) => interaction([{ type: 'text', text: JSON.stringify(object) }]);
const groqText = (object) => Response.json({ choices: [{ message: { content: JSON.stringify(object) } }] });

/** Records every request and answers with the next reply in the list (the last one repeats). */
function recorder(...replies) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return typeof reply === 'function' ? reply() : reply.clone();
  };
  return { calls, fetchImpl };
}

/** Runs fn with console.error silenced and returns what was logged. */
async function quietly(fn) {
  const real = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return logged.join('\n');
}

const KEYS = { GEMINI_API_KEY: 'gemini-secret', GROQ_API_KEY: 'groq-secret' };

test('model layer: provider and model come from the kind of call and the environment', () => {
  assert.deepEqual(resolve('text', {}), { provider: 'groq', model: 'openai/gpt-oss-120b' });
  assert.deepEqual(resolve('text', { GROQ_MODEL: 'other' }), { provider: 'groq', model: 'other' });
  assert.deepEqual(resolve('text', { TEXT_PROVIDER: 'gemini' }), { provider: 'gemini', model: 'gemini-3.5-flash-lite' });
  assert.deepEqual(resolve('turn', {}), { provider: 'gemini', model: 'gemini-3.5-flash-lite' });
  assert.deepEqual(resolve('plan', {}), { provider: 'gemini', model: 'gemini-3.8-flash' });
  assert.deepEqual(resolve('report', { GEMINI_REPORT_MODEL: 'gemini-3.1-pro-preview' }), { provider: 'gemini', model: 'gemini-3.1-pro-preview' });
  assert.throws(() => resolve('unknown', {}));
});

test('model layer: a Gemini turn carries the instruction, the earlier turns, the recording and the schema, and is not stored', async () => {
  const { calls, fetchImpl } = recorder(geminiText({ decision: 'next' }));
  const schema = { type: 'object', properties: { decision: { type: 'string' } }, required: ['decision'] };
  const result = await askJson({
    use: 'turn',
    system: 'You are the interviewer.',
    messages: [
      { role: 'system', content: 'Never give the answer away.' },
      { role: 'user', content: 'Profile: Second Engineer.' },
      { role: 'assistant', content: 'Tell me about your last vessel.' },
      { role: 'user', content: 'The answer is in the recording.', audio: { data: 'QUJD', mimeType: 'audio/webm' } },
    ],
    schema,
    validate: (parsed) => parsed.decision,
  }, KEYS, fetchImpl);

  assert.equal(result, 'next');
  assert.equal(calls.length, 1);
  const { url, headers, body } = calls[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(headers['x-goog-api-key'], 'gemini-secret');
  assert.equal(body.store, false);
  assert.equal(body.model, 'gemini-3.5-flash-lite');
  assert.equal(body.system_instruction, 'You are the interviewer.\n\nNever give the answer away.');
  assert.deepEqual(body.input.map((step) => step.type), ['user_input', 'model_output', 'user_input']);
  assert.deepEqual(body.input[2].content, [
    { type: 'text', text: 'The answer is in the recording.' },
    { type: 'audio', data: 'QUJD', mime_type: 'audio/webm' },
  ]);
  assert.deepEqual(body.response_format, { type: 'text', mime_type: 'application/json', schema });
  assert.equal('generation_config' in body, false);
});

test('model layer: the Gemini address comes from GEMINI_BASE_URL', async () => {
  const { calls, fetchImpl } = recorder(geminiText({}));
  await askJson({ use: 'plan', messages: [{ role: 'user', content: 'x' }], temperature: 0, maxTokens: 500 }, { ...KEYS, GEMINI_BASE_URL: 'https://proxy.example/' }, fetchImpl);
  assert.equal(calls[0].url, 'https://proxy.example/v1beta/interactions');
  assert.equal(calls[0].body.model, 'gemini-3.8-flash');
  assert.deepEqual(calls[0].body.generation_config, { temperature: 0, max_output_tokens: 500 });
});

test('model layer: the written plan can move from Groq to Gemini with one variable', async () => {
  const messages = [{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'Topic.' }];
  const viaGroq = recorder(groqText({ ok: 1 }));
  await askJson({ use: 'text', messages }, KEYS, viaGroq.fetchImpl);
  assert.match(viaGroq.calls[0].url, /api\.groq\.com/);
  assert.equal(viaGroq.calls[0].headers.Authorization, 'Bearer groq-secret');
  assert.deepEqual(viaGroq.calls[0].body.messages, messages);

  const viaGemini = recorder(geminiText({ ok: 1 }));
  await askJson({ use: 'text', messages }, { ...KEYS, TEXT_PROVIDER: 'gemini' }, viaGemini.fetchImpl);
  assert.match(viaGemini.calls[0].url, /generativelanguage/);
  assert.equal(viaGemini.calls[0].body.system_instruction, 'Rules.');
  assert.equal(viaGemini.calls[0].body.store, false);
});

test('model layer: one retry on a server error and on an unusable answer, none on a client error', async () => {
  const flaky = recorder(new Response('{"error":"overloaded"}', { status: 503 }), geminiText({ n: 2 }));
  await quietly(async () => {
    assert.deepEqual(await askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }] }, KEYS, flaky.fetchImpl), { n: 2 });
  });
  assert.equal(flaky.calls.length, 2);

  const invalid = recorder(geminiText({ wrong: true }), geminiText({ right: true }));
  const validate = (parsed) => {
    if (!parsed.right) throw new Error('missing field');
    return 'ok';
  };
  await quietly(async () => {
    assert.equal(await askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }], validate }, KEYS, invalid.fetchImpl), 'ok');
  });
  assert.equal(invalid.calls.length, 2);

  const alwaysInvalid = recorder(geminiText({ wrong: true }));
  await quietly(async () => {
    await assert.rejects(
      askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }], validate, failMessage: 'Could not mark this answer.' }, KEYS, alwaysInvalid.fetchImpl),
      (err) => err instanceof LlmError && err.status === 502 && err.message === 'Could not mark this answer.',
    );
  });
  assert.equal(alwaysInvalid.calls.length, 2);

  const rejected = recorder(new Response('{"error":{"message":"API key not valid: gemini-secret"}}', { status: 400 }));
  await quietly(async () => {
    await assert.rejects(
      askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }] }, KEYS, rejected.fetchImpl),
      (err) => err instanceof LlmError && err.status === 503 && !err.message.includes('gemini-secret'),
    );
  });
  assert.equal(rejected.calls.length, 1);

  const busy = recorder(new Response('{}', { status: 429 }));
  await quietly(async () => {
    await assert.rejects(askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }] }, KEYS, busy.fetchImpl), (err) => err.status === 503 && /busy/.test(err.message));
  });
  assert.equal(busy.calls.length, 1);
});

test('model layer: no key or audio for a provider that cannot listen means no request at all', async () => {
  const { calls, fetchImpl } = recorder(geminiText({}));
  await quietly(async () => {
    await assert.rejects(askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }] }, {}, fetchImpl), (err) => err.status === 503);
    await assert.rejects(
      askJson({ use: 'text', messages: [{ role: 'user', content: 'x', audio: { data: 'QUJD', mimeType: 'audio/webm' } }] }, KEYS, fetchImpl),
      (err) => err.status === 503,
    );
  });
  assert.equal(calls.length, 0);
});

test('model layer: what the candidate said never reaches the server log', async () => {
  const { fetchImpl } = recorder(new Response('{"error":"overloaded"}', { status: 500 }));
  const logged = await quietly(async () => {
    await assert.rejects(askJson({ use: 'turn', messages: [{ role: 'user', content: 'My name is Ivan Petrov and I sailed on Aurora.' }] }, KEYS, fetchImpl));
  });
  assert.equal(logged.includes('Ivan Petrov'), false);
  assert.equal(logged.includes('Aurora'), false);
  assert.equal(logged.includes('gemini-secret'), false);
});

test('model layer: a provider error body that echoes the key, the request or a half-written answer stays out of the log', async () => {
  const messages = [{ role: 'user', content: 'My name is Ivan Petrov.', audio: { data: 'UkVDT1JESU5H', mimeType: 'audio/webm' } }];
  const echo = JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key gemini-secret is not valid', details: [{ input: 'My name is Ivan Petrov.', audio: 'UkVDT1JESU5H' }] } });
  const gemini = recorder(new Response(echo, { status: 400 }));
  const geminiLog = await quietly(async () => {
    await assert.rejects(askJson({ use: 'turn', messages }, KEYS, gemini.fetchImpl), (err) => !err.message.includes('gemini-secret'));
  });
  assert.match(geminiLog, /HTTP 400: INVALID_ARGUMENT: API key \*\*\* is not valid/);
  for (const secret of ['gemini-secret', 'Ivan Petrov', 'UkVDT1JESU5H']) assert.equal(geminiLog.includes(secret), false);

  // Groq puts the model's partial answer into failed_generation when JSON mode fails.
  const failed = JSON.stringify({ error: { message: 'Failed to generate JSON', type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: '{"name":"Ivan Petrov"' } });
  const groq = recorder(new Response(failed, { status: 400 }), groqText({ ok: 1 }));
  const groqLog = await quietly(async () => {
    assert.deepEqual(await askJson({ use: 'text', messages: [{ role: 'user', content: 'x' }] }, KEYS, groq.fetchImpl), { ok: 1 });
  });
  assert.equal(groq.calls.length, 2);
  assert.equal('response_format' in groq.calls[1].body, false);
  assert.equal(groqLog.includes('Ivan Petrov'), false);

  // An answer that is not JSON is named, not quoted.
  const garbled = recorder(interaction([{ type: 'text', text: '{"transcript": Ivan Petrov said' }]));
  const garbledLog = await quietly(async () => {
    await assert.rejects(askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }] }, KEYS, garbled.fetchImpl));
  });
  assert.match(garbledLog, /the answer could not be used/);
  assert.equal(garbledLog.includes('Ivan'), false);

  assert.equal(summarise('<html>Bad gateway</html>'), 'error body of 24 characters, not shown');
});

test('model layer: a dropped connection is tried once more', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return geminiText({ ok: 1 });
  };
  const logged = await quietly(async () => {
    assert.deepEqual(await askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }] }, KEYS, fetchImpl), { ok: 1 });
  });
  assert.equal(calls, 2);
  assert.match(logged, /attempt 1: no connection: ECONNRESET/);

  const down = async () => { throw new TypeError('fetch failed'); };
  await quietly(async () => {
    await assert.rejects(askJson({ use: 'turn', messages: [{ role: 'user', content: 'x' }] }, KEYS, down), (err) => err.status === 502 && err.cause?.network === true);
    assert.equal(await synthesize('Hello.', KEYS, down), null);
  });
});

test('speech layer: Gemini voices the line and the request is not stored', async () => {
  const clip = Buffer.alloc(3000, 5);
  const { calls, fetchImpl } = recorder(interaction([{ type: 'audio', mime_type: 'audio/wav', data: clip.toString('base64') }]));
  const spoken = await synthesize('  Tell me about your last vessel.  ', { ...KEYS, GEMINI_VOICE: 'Puck' }, fetchImpl);
  assert.equal(spoken.mimeType, 'audio/wav');
  assert.equal(spoken.audio.equals(clip), true);
  const { body } = calls[0];
  assert.equal(body.store, false);
  assert.equal(body.model, 'gemini-3.8-flash-lite-tts');
  assert.equal(body.input[0].content[0].text, 'Tell me about your last vessel.');
  assert.deepEqual(body.generation_config, { speech_config: [{ voice: 'Puck' }] });
});

test('speech layer: the browser speaks when synthesis is off, over its limit or failing', async () => {
  assert.equal(speechMode(KEYS), 'gemini');
  assert.equal(speechMode({ ...KEYS, SPEECH_PROVIDER: 'browser' }), 'browser');
  assert.equal(speechMode({}), 'browser');

  const off = recorder(interaction([]));
  assert.equal(await synthesize('Hello.', { ...KEYS, SPEECH_PROVIDER: 'browser' }, off.fetchImpl), null);
  assert.equal(await synthesize('   ', KEYS, off.fetchImpl), null);
  assert.equal(off.calls.length, 0);

  const overLimit = recorder(new Response('{}', { status: 429 }));
  const noAudio = recorder(interaction([{ type: 'text', text: 'sorry' }]));
  const logged = await quietly(async () => {
    assert.equal(await synthesize('A question nobody should see in the log.', KEYS, overLimit.fetchImpl), null);
    assert.equal(await synthesize('Hello.', KEYS, noAudio.fetchImpl), null);
  });
  // The daily limit is not retried; an answer without audio is tried once more.
  assert.equal(overLimit.calls.length, 1);
  assert.equal(noAudio.calls.length, 2);
  assert.equal(logged.includes('nobody should see'), false);
});
