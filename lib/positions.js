import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { marked } from 'marked';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../content/positions/', import.meta.url));

export const DEPARTMENTS = [
  { id: 'deck', label: 'Deck' },
  { id: 'engine', label: 'Engine' },
  { id: 'catering', label: 'Catering' },
];

/** Minimal front matter parser: flat `key: value` pairs between --- lines. */
export function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(m[0].length) };
}

/** Splits the body on `## Q:` headings. Text before the first heading is ignored. */
export function parseQuestions(body) {
  const parts = body.split(/^##\s*Q:\s*/m).slice(1);
  return parts
    .map((part) => {
      const nl = part.indexOf('\n');
      const question = (nl === -1 ? part : part.slice(0, nl)).trim();
      const answerMd = (nl === -1 ? '' : part.slice(nl + 1)).trim();
      // [Text in brackets] marks a gap for the reader's own details, highlighted like in the plan.
      const answerHtml = marked.parse(answerMd).replace(/\[([^\]<>\n]{1,200})\]/g, '<mark class="gap">[$1]</mark>');
      return { question, answerHtml };
    })
    .filter((q) => q.question && q.answerHtml.trim());
}

export function loadPositions(dir = DIR) {
  const positions = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const { data, body } = parseFrontMatter(readFileSync(join(dir, file), 'utf8'));
      const slug = basename(file, '.md');
      if (!data.title || !DEPARTMENTS.some((d) => d.id === data.department)) {
        throw new Error(`content/positions/${file}: front matter needs title and department (deck|engine|catering)`);
      }
      return {
        slug,
        title: data.title,
        department: data.department,
        order: Number(data.order) || 999,
        questions: parseQuestions(body),
      };
    });
  positions.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return positions;
}
