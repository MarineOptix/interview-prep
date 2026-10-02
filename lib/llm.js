import { buildMessages, PLACEHOLDER_HINT } from './prompt.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export class LlmError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// llama-3.3-70b-versatile was decommissioned by Groq on 2026-08-16; gpt-oss-120b is Groq's recommended replacement.
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';

const UNAVAILABLE = 'The plan service is not available right now. Try again later.';

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

export function buildRequestBody(topic, profile, model = DEFAULT_MODEL) {
  return buildBody(buildMessages(topic, profile), model);
}

/**
 * Sends messages to Groq and returns `validate(parsedJson)`.
 * Retries once on network errors, 5xx and output that fails validation; never on 4xx.
 */
export async function requestJson(messages, validate, env = process.env, options = {}) {
  if (!env.GROQ_API_KEY) {
    console.error('[llm] GROQ_API_KEY is not set');
    throw new LlmError(UNAVAILABLE, 503);
  }

  const body = buildBody(messages, env.GROQ_MODEL || DEFAULT_MODEL, options);

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // Two attempts must fit in the 60 s function limit on Vercel.
        signal: AbortSignal.timeout(28_000),
      });
      if (res.status === 429) throw new LlmError('The AI service is busy. Try again in a minute.', 503);
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        // If the model rejects JSON mode, try once more without it: the prompt already asks for JSON.
        if (res.status === 400 && body.response_format && /response_format|json/i.test(detail)) {
          console.error(`[llm] JSON mode rejected for ${body.model}, retrying without it: ${detail}`);
          delete body.response_format;
          attempt--;
          continue;
        }
        // Details go to the server log; the visitor gets a plain message.
        console.error(`[llm] Groq ${res.status} for model ${body.model}: ${detail}`);
        // 4xx means wrong key, model or request: retrying will not help.
        throw new LlmError(res.status < 500 ? UNAVAILABLE : 'The AI service had a problem. Try again.', res.status < 500 ? 503 : 502);
      }
      const data = await res.json();
      return validate(parseJson(data.choices?.[0]?.message?.content));
    } catch (err) {
      lastError = err;
      if (err instanceof LlmError && err.status === 503) break;
      console.error(`[llm] attempt ${attempt} failed: ${err.message}`);
    }
  }
  throw lastError instanceof LlmError ? lastError : new LlmError(options.failMessage || 'The AI could not complete this. Try again.');
}

/** Generates the questions for one topic. Returns an array of question objects. */
export async function generateTopic(topic, profile, env = process.env) {
  if (env.MOCK_LLM === '1') return mockTopic(topic, profile);
  return requestJson(buildMessages(topic, profile), (parsed) => normalise(parsed, topic), env, {
    failMessage: 'The plan could not be written for this topic. Try again.',
  });
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

/** Validates model output and keeps only well-formed questions. */
export function normalise(parsed, topic) {
  const items = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const questions = items
    .map((q) => ({
      question: text(q?.question, 400),
      whyAsked: text(q?.why_asked, 400),
      answer: text(q?.answer, 4000),
      keyPoints: (Array.isArray(q?.key_points) ? q.key_points : []).map((p) => text(p, 300)).filter(Boolean).slice(0, 6),
      followUp: text(q?.follow_up, 400),
    }))
    .filter((q) => q.question && q.answer)
    .slice(0, topic.count + 1);
  if (!questions.length) throw new LlmError('The AI returned an empty answer for this topic.');
  return questions;
}

function mockTopic(topic, profile) {
  const { resume, vacancy } = profile;
  return Array.from({ length: topic.count }, (_, i) => ({
    question: `${topic.title}: sample question ${i + 1} for a ${resume.targetPosition} on a ${vacancy.vesselType.toLowerCase()}?`,
    whyAsked: 'Mock mode: the interviewer wants to see how you connect your experience to this vacancy.',
    answer:
      `I have ${resume.yearsAtSea} years at sea, currently as ${resume.currentRank}. ` +
      `This is a mock answer generated without calling the AI, so the layout can be checked.\n\n` +
      `On my last contract ${PLACEHOLDER_HINT} and I would bring the same approach to your ${vacancy.vesselType.toLowerCase()}.`,
    keyPoints: ['Mention your rank and sea service', 'Give one concrete example', 'Link it to the vacancy'],
    followUp: 'What would you do differently next time?',
  }));
}
