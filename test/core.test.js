import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPositions, parseFrontMatter } from '../lib/positions.js';
import { cleanProfile } from '../lib/form.js';
import { buildMessages } from '../lib/prompt.js';
import { normalise } from '../lib/llm.js';
import { TOPICS, getTopic } from '../lib/topics.js';
import { html, raw } from '../lib/html.js';

const fixtures = new URL('./fixtures/positions/', import.meta.url).pathname;

test('parses front matter and questions, skipping empty answers', () => {
  const [p] = loadPositions(fixtures);
  assert.equal(p.slug, 'sample');
  assert.equal(p.title, 'Sample Officer');
  assert.equal(p.questions.length, 2);
  assert.equal(p.questions[0].question, 'First question?');
  assert.match(p.questions[0].answerHtml, /<strong>answer<\/strong>/);
  assert.match(p.questions[0].answerHtml, /<li>point one<\/li>/);
});

test('real content: 17 positions with valid departments', () => {
  const all = loadPositions();
  assert.equal(all.length, 17);
  assert.deepEqual([...new Set(all.map((p) => p.department))], ['deck', 'engine', 'catering']);
  assert.equal(parseFrontMatter('no front matter').body, 'no front matter');
});

const positions = loadPositions();
const validInput = {
  resume: {
    targetPosition: 'chief-engineer', currentRank: 'Second Engineer', name: 'Ivan Petrov',
    vesselTypes: ['Bulk carrier', 'Not a real type'], yearsAtSea: '9', yearsInRank: '3',
    certificates: ['High Voltage'], duties: 'Planned maintenance of main engine MAN B&W, overhauls, bunkering supervision.',
  },
  vacancy: { vesselType: 'Bulk carrier', mainEngine: 'MAN B&W 6S50ME-C', requirements: 'ME-C experience' },
  name: 'Ivan Petrov',
};

test('profile cleaning drops the name and unknown options', () => {
  const { profile, errors } = cleanProfile(validInput, positions);
  assert.deepEqual(errors, []);
  assert.equal(JSON.stringify(profile).includes('Ivan'), false);
  assert.deepEqual(profile.resume.vesselTypes, ['Bulk carrier']);
  assert.equal(profile.resume.department, 'engine');
  assert.equal(profile.vacancy.mainEngine, 'MAN B&W 6S50ME-C');
});

test('main engine is dropped for deck ranks; missing fields are reported', () => {
  const { profile } = cleanProfile({ ...validInput, resume: { ...validInput.resume, targetPosition: 'bosun' } }, positions);
  assert.equal(profile.vacancy.mainEngine, '');
  const { errors } = cleanProfile({ resume: {}, vacancy: {} }, positions);
  assert.equal(errors.length, 6);
});

test('prompt contains resume facts and the right knowledge file, never the name', () => {
  const { profile } = cleanProfile(validInput, positions);
  const [system, user] = buildMessages(getTopic('technical'), profile);
  assert.match(system.content, /only source of facts/);
  assert.match(user.content, /Second Engineer/);
  assert.match(user.content, /Engine department — technical reference/);
  assert.equal(user.content.includes('Ivan'), false);
});

test('plan has 10-20 questions across topics', () => {
  const total = TOPICS.reduce((n, t) => n + t.count, 0);
  assert.ok(total >= 10 && total <= 20);
});

test('normalise keeps valid questions and rejects empty output', () => {
  const topic = getTopic('contract');
  const qs = normalise({ questions: [{ question: 'Q?', answer: 'A', key_points: ['x', 5] }, { question: '' }] }, topic);
  assert.equal(qs.length, 1);
  assert.deepEqual(qs[0].keyPoints, ['x']);
  assert.throws(() => normalise({}, topic));
});

test('html escapes interpolations unless raw', () => {
  assert.equal(html`<p>${'<b>'}</p>`.toString(), '<p>&lt;b&gt;</p>');
  assert.equal(html`<p>${raw('<b>')}</p>`.toString(), '<p><b></p>');
});

test('request body uses gpt-oss with low reasoning effort by default', async () => {
  const { buildRequestBody, DEFAULT_MODEL } = await import('../lib/llm.js');
  const { profile } = cleanProfile(validInput, positions);
  const body = buildRequestBody(getTopic('safety'), profile);
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(buildRequestBody(getTopic('safety'), profile, 'some/other-model').reasoning_effort, undefined);
});

test('a Groq 404 is not retried and gives a plain message', async () => {
  const { generateTopic } = await import('../lib/llm.js');
  const { profile } = cleanProfile(validInput, positions);
  let calls = 0;
  const realFetch = globalThis.fetch;
  const realError = console.error;
  console.error = () => {};
  globalThis.fetch = async () => { calls++; return new Response('{"error":"model_not_found"}', { status: 404 }); };
  try {
    await assert.rejects(generateTopic(getTopic('safety'), profile, { GROQ_API_KEY: 'x' }), (e) => e.status === 503 && !e.message.includes('model'));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
});

test('falls back without JSON mode and parses fenced JSON', async () => {
  const { generateTopic, parseJson } = await import('../lib/llm.js');
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  const { profile } = cleanProfile(validInput, positions);
  const bodies = [];
  const realFetch = globalThis.fetch;
  const realError = console.error;
  console.error = () => {};
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    if (body.response_format) return new Response('{"error":{"message":"response_format is not supported"}}', { status: 400 });
    const content = 'Here you go:\n{"questions":[{"question":"Q?","answer":"A."}]}';
    return Response.json({ choices: [{ message: { content } }] });
  };
  try {
    const qs = await generateTopic(getTopic('contract'), profile, { GROQ_API_KEY: 'x' });
    assert.equal(qs[0].question, 'Q?');
    assert.equal(bodies.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
});

test('question bank: every rank has rank-specific questions for the core topics', async () => {
  const { bankFor, parseBank } = await import('../lib/question-bank.js');
  assert.deepEqual(parseBank('# Title\nintro\n## safety\n- A?\n- B?\n'), { safety: ['A?', 'B?'] });
  for (const p of positions) {
    for (const topic of ['experience', 'conventions', 'safety', 'technical']) {
      const own = bankFor(p.slug, topic).length - bankFor('no-such-rank', topic).length;
      assert.ok(own >= 3, `${p.slug} / ${topic} has only ${own} own questions`);
    }
    for (const t of TOPICS) assert.ok(bankFor(p.slug, t.id).length >= t.count, `${p.slug} / ${t.id}`);
  }
});

test('prompt includes the question bank for the rank and topic', () => {
  const { profile } = cleanProfile(validInput, positions);
  const [system, user] = buildMessages(getTopic('safety'), profile);
  assert.match(system.content, /QUESTION BANK/);
  assert.match(user.content, /QUESTION BANK[\s\S]*crankcase explosion/);
});

test('funnel pages: allowed steps render, analytics script only on Vercel', async () => {
  const { trackPage, TRACK_STEPS } = await import('../lib/pages.js');
  assert.deepEqual(TRACK_STEPS, ['cv-imported', 'vacancy-imported', 'plan-started', 'plan-ready', 'pdf-saved']);
  assert.match(trackPage('plan-ready'), /<title>plan-ready<\/title>/);
  assert.equal(trackPage('plan-ready').includes('_vercel/insights'), Boolean(process.env.VERCEL));
});

test('extraction: ranks are matched, lists whitelisted, sea service turned into lines', async () => {
  const { cleanExtracted, matchRank } = await import('../lib/extract.js');
  assert.equal(matchRank('4th Engineer', positions).slug, 'fourth-engineer');
  assert.equal(matchRank('Chief Mate', positions).slug, 'chief-officer');
  assert.equal(matchRank('AB', positions).slug, 'able-seaman');
  assert.equal(matchRank('Able Seaman (AB)', positions).slug, 'able-seaman');
  assert.equal(matchRank('Fitter', positions), undefined);

  const cv = cleanExtracted('cv', {
    applied_rank: 'Third Engineer', current_rank: '4/E', years_at_sea: '3.5', years_in_current_rank: 99,
    vessel_types: ['Bulk carrier', '<script>'], certificates: ['High Voltage', 'Fake'], english_level: 'Native',
    sea_service: [{ rank: '4/E', vessel_type: 'Bulk carrier', size: '57,000 DWT', engine: 'MAN B&W 6S50MC, 8,200 kW', period: '6 months' }, { rank: '' }],
    duties: 'Purifiers.', name: 'Ivan Petrov',
  }, positions);
  assert.equal(cv.targetPosition, 'third-engineer');
  assert.equal(cv.currentRank, 'Fourth Engineer');
  assert.equal(cv.yearsAtSea, '3.5');
  assert.equal(cv.yearsInRank, '');
  assert.deepEqual(cv.vesselTypes, ['Bulk carrier']);
  assert.deepEqual(cv.certificates, ['High Voltage']);
  assert.equal(cv.englishLevel, '');
  assert.equal(cv.seaService, '4/E | Bulk carrier, 57,000 DWT | MAN B&W 6S50MC, 8,200 kW | 6 months');
  assert.equal(JSON.stringify(cv).includes('Ivan'), false);

  const vac = cleanExtracted('vacancy', { rank: 'Fourth Engineer', vessel_type: 'Heavy lift vessel', vessel_size: '20,000 DWT', requirements: 'US visa' }, positions);
  assert.equal(vac.targetPosition, 'fourth-engineer');
  assert.equal(vac.vesselType, '');
  assert.match(vac.requirements, /Vessel type: Heavy lift vessel\nUS visa/);
  assert.deepEqual(cleanExtracted('cv', null, positions).vesselTypes, []);
});

test('link reading refuses private addresses and turns HTML into text', async () => {
  const { assertPublicUrl, htmlToText, fetchPageText } = await import('../lib/extract.js');
  const pub = async () => [{ address: '93.184.216.34' }];
  const priv = async () => [{ address: '10.0.0.5' }];
  await assert.rejects(assertPublicUrl('file:///etc/passwd', pub));
  await assert.rejects(assertPublicUrl('http://127.0.0.1/admin', pub));
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest', pub));
  await assert.rejects(assertPublicUrl('http://[::1]/', pub));
  await assert.rejects(assertPublicUrl('https://internal.example/', priv));
  await assert.rejects(assertPublicUrl('https://example.com:8080/', pub));
  assert.equal((await assertPublicUrl('https://example.com/job', pub)).hostname, 'example.com');
  assert.equal(htmlToText('<head><title>x</title></head><p>Chief &amp; Co</p><script>bad()</script><li>4/E</li>'), 'Chief & Co\n4/E');

  // A redirect to a private address is refused at the second hop.
  const hops = [];
  const fetchImpl = async (u) => { hops.push(String(u)); return new Response('', { status: 302, headers: { location: 'http://192.168.1.1/' } }); };
  const resolve = async (host) => [{ address: host === 'example.com' ? '93.184.216.34' : '192.168.1.1' }];
  await assert.rejects(fetchPageText('https://example.com/a', { fetchImpl, resolve }));
  assert.equal(hops.length, 1);
});

test('prompt carries the sea service record and no flag', () => {
  const input = { ...validInput, resume: { ...validInput.resume, seaService: '4/E | Bulk carrier, 57,000 DWT | MAN B&W 6S50MC | 6 months' }, vacancy: { ...validInput.vacancy, flag: 'Panama' } };
  const { profile } = cleanProfile(input, positions);
  const user = buildMessages(getTopic('experience'), profile)[1].content;
  assert.match(user, /Sea service record[\s\S]*57,000 DWT/);
  assert.equal(user.includes('Panama'), false);
});

test('contacts: valid values become links, malformed ones are ignored', async () => {
  const { contactLinks } = await import('../lib/pages.js');
  assert.deepEqual(contactLinks({}), []);
  assert.deepEqual(contactLinks({ CONTACT_TELEGRAM: '@sea_prep', CONTACT_EMAIL: ' hello@example.com ' }), [
    { label: 'Telegram @sea_prep', href: 'https://t.me/sea_prep' },
    { label: 'hello@example.com', href: 'mailto:hello@example.com' },
  ]);
  assert.equal(contactLinks({ CONTACT_TELEGRAM: 'https://t.me/sea_prep' })[0].href, 'https://t.me/sea_prep');
  assert.deepEqual(contactLinks({ CONTACT_TELEGRAM: 'x"><script>', CONTACT_EMAIL: 'not an email' }), []);
});
