import { buildMessages, PLACEHOLDER_HINT } from './prompt.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export class LlmError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Generates the questions for one topic. Returns an array of question objects. */
export async function generateTopic(topic, profile, env = process.env) {
  if (env.MOCK_LLM === '1') return mockTopic(topic, profile);
  if (!env.GROQ_API_KEY) throw new LlmError('GROQ_API_KEY is not set on the server.', 500);

  const body = {
    model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages: buildMessages(topic, profile),
    temperature: 0.4,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  };

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
      if (!res.ok) throw new LlmError(`AI service error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return normalise(JSON.parse(data.choices?.[0]?.message?.content ?? '{}'), topic);
    } catch (err) {
      lastError = err;
      if (err instanceof LlmError && err.status === 503) break;
    }
  }
  throw lastError instanceof LlmError ? lastError : new LlmError(`Generation failed: ${lastError?.message}`);
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
