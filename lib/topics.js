/**
 * The interview plan is generated one topic per LLM call, in this order.
 * `count` is the number of questions requested for the topic (total 17).
 * `knowledge` lists knowledge-base files (content/knowledge-base/<name>.md) used as grounding;
 * "technical" resolves to technical-<department>.md.
 */
export const TOPICS = [
  {
    id: 'motivation',
    title: 'About you and your motivation',
    count: 2,
    knowledge: ['interview-general'],
    brief:
      'Opening questions: tell me about yourself, why this company / this vessel type / this rank, career plans. ' +
      'Answers should connect the candidate’s real background to the vacancy.',
  },
  {
    id: 'experience',
    title: 'Sea service and experience',
    count: 3,
    knowledge: ['interview-general'],
    brief:
      'Questions probing the candidate’s actual sea service: vessel types, duties in rank, a difficult situation they handled, ' +
      'how their experience fits the vacancy’s vessel type and trading area.',
  },
  {
    id: 'conventions',
    title: 'Regulations and conventions',
    count: 3,
    knowledge: ['conventions'],
    brief:
      'Knowledge questions on STCW, SOLAS, MARPOL, ISM, ISPS and MLC 2006 at the depth expected for this rank. ' +
      'Pick the conventions most relevant to the rank and vessel type. Answers explain the rule and how the candidate applies it on board.',
  },
  {
    id: 'safety',
    title: 'Safety and emergencies',
    count: 3,
    knowledge: ['safety'],
    brief:
      'Emergency response and safe working: fire, abandon ship, man overboard, enclosed space entry, permits to work, ' +
      'drills, near-miss reporting. Choose scenarios typical for the rank and vessel type.',
  },
  {
    id: 'technical',
    title: 'Role-specific technical questions',
    count: 3,
    knowledge: ['technical'],
    brief:
      'Technical questions an interviewer would ask for this exact rank on this vessel type ' +
      '(e.g. cargo operations and stability for deck officers, machinery and maintenance for engineers, galley hygiene and provisions for catering).',
  },
  {
    id: 'leadership',
    title: 'Teamwork, leadership and communication',
    count: 2,
    knowledge: ['leadership'],
    brief:
      'Behavioural questions: working in a multinational crew, handling conflict, giving and receiving instructions, ' +
      'supervising juniors (for officers and senior ratings), fatigue and stress.',
  },
  {
    id: 'contract',
    title: 'Contract and closing questions',
    count: 1,
    knowledge: ['interview-general'],
    brief:
      'Closing part of the interview: availability, contract length, salary expectations handled professionally, ' +
      'and good questions the candidate can ask the interviewer.',
  },
];

export function getTopic(id) {
  return TOPICS.find((t) => t.id === id);
}
