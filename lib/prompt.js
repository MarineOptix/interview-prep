import { knowledgeFor } from './knowledge.js';
import { bankFor } from './question-bank.js';

export const PLACEHOLDER_HINT = '[add your own example: …]';

function describeResume(r) {
  const lines = [
    `Applying for: ${r.targetPosition}`,
    `Current or last rank: ${r.currentRank}`,
    `Vessel types served on: ${[...r.vesselTypes, r.otherVesselTypes].filter(Boolean).join(', ') || 'not stated'}`,
    `Total sea service: ${r.yearsAtSea ?? 'not stated'} years`,
    `Time in current rank: ${r.yearsInRank ?? 'not stated'} years`,
    `Certificates: ${[...r.certificates, r.otherCertificates].filter(Boolean).join('; ') || 'not stated'}`,
    `English: ${r.englishLevel || 'not stated'}${r.marlinsScore !== null ? `, Marlins test ${r.marlinsScore}%` : ''}`,
    `Duties and achievements (candidate's own words):\n${r.duties}`,
  ];
  return lines.join('\n');
}

function describeVacancy(v) {
  const lines = [
    `Vessel type: ${v.vesselType}`,
    v.vesselSize && `Size: ${v.vesselSize}`,
    v.mainEngine && `Main engine: ${v.mainEngine}`,
    v.tradingArea && `Trading area: ${v.tradingArea}`,
    v.flag && `Flag: ${v.flag}`,
    v.contractLength && `Contract length: ${v.contractLength}`,
    v.company && `Company: ${v.company}`,
    v.requirements && `Requirements from the job advert:\n${v.requirements}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function bankSection(questions) {
  if (!questions.length) return '';
  return `QUESTION BANK (typical questions for this rank and topic)\n${questions.map((q) => `- ${q}`).join('\n')}\n\n`;
}

/** Builds chat messages for one topic of the plan. */
export function buildMessages(topic, profile) {
  const { resume, vacancy } = profile;

  const system = `You are an experienced maritime crewing manager who prepares seafarers for job interviews.
You write interview questions and model answers in English. The answers are written in the first person, as the candidate would say them in the interview.

Strict rules about facts:
1. The CANDIDATE RESUME is the only source of facts about the candidate. Never invent vessel names, companies, years, numbers, incidents, certificates or achievements that are not in the resume.
2. When a strong answer needs a personal example or detail the resume does not contain, write a placeholder in square brackets for the candidate to fill in, for example "${PLACEHOLDER_HINT}" or "[name of the vessel]". Placeholders are better than invented facts.
3. The REFERENCE KNOWLEDGE is general maritime information (regulations, procedures). Use it for accuracy. Do not state regulatory figures that are not in the reference knowledge unless you are certain they are correct.
4. Do not claim the candidate holds a certificate or has served on a vessel type unless the resume says so. If the vacancy needs experience the candidate lacks, the answer should honestly acknowledge the gap and show how they will close it.
5. Pitch the depth to the rank: management level, operational level, rating or cadet.

Choosing the questions:
6. When a QUESTION BANK is given, build the questions from it. These are questions crewing managers really ask for this rank. Pick the ones most relevant to this vacancy (vessel type, engine, trading area, advert requirements) and to gaps in the candidate's experience, and adapt the wording to the vacancy. Do not invent a question outside the bank unless the bank misses something the vacancy clearly requires.
7. Do not repeat the same question twice.

Return only JSON with this shape:
{"questions":[{"question":"...","why_asked":"one sentence: what the interviewer wants to find out","answer":"model answer, 120-250 words, plain text, paragraphs separated by \\n\\n","key_points":["3-5 short points to remember"],"follow_up":"a likely follow-up question"}]}`;

  const user = `TOPIC: ${topic.title}
What to cover: ${topic.brief}
Number of questions: exactly ${topic.count}

CANDIDATE RESUME
${describeResume(resume)}

VACANCY
${describeVacancy(vacancy)}

${bankSection(bankFor(resume.slug, topic.id))}REFERENCE KNOWLEDGE
${knowledgeFor(topic, resume.department)}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
