import { buildMessages, PLACEHOLDER_HINT } from './prompt.js';
import { askJson, LlmError, parseJson } from './ai/llm.js';
import { buildBody, DEFAULT_MODEL } from './ai/groq.js';

// The written plan: one model call per topic. The call itself goes through the model layer in lib/ai/.
export { LlmError, parseJson, DEFAULT_MODEL };

export function buildRequestBody(topic, profile, model = DEFAULT_MODEL) {
  return buildBody(buildMessages(topic, profile), model);
}

/** Generates the questions for one topic. Returns an array of question objects. */
export async function generateTopic(topic, profile, env = process.env) {
  if (env.MOCK_LLM === '1') return mockTopic(topic, profile);
  return askJson({
    use: 'text',
    messages: buildMessages(topic, profile),
    validate: (parsed) => normalise(parsed, topic),
    failMessage: 'The plan could not be written for this topic. Try again.',
  }, env);
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
