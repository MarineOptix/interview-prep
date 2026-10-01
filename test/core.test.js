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
