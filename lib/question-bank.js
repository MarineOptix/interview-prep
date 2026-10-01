import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../content/question-bank/', import.meta.url));
const cache = new Map();

/**
 * Parses a bank file: `## <topic-id>` headings, each followed by `- question` lines.
 * Returns { [topicId]: string[] }.
 */
export function parseBank(text) {
  const bank = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+([a-z-]+)\s*$/);
    if (heading) {
      current = heading[1];
      bank[current] ??= [];
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (item && current) bank[current].push(item[1]);
  }
  return bank;
}

function load(name, dir) {
  const key = `${dir}${name}`;
  if (!cache.has(key)) {
    const path = `${dir}${name}.md`;
    cache.set(key, existsSync(path) ? parseBank(readFileSync(path, 'utf8')) : {});
  }
  return cache.get(key);
}

/** Typical interview questions for one rank and topic: rank-specific first, then the common ones. */
export function bankFor(slug, topicId, dir = DIR) {
  const own = load(slug, dir)[topicId] ?? [];
  const common = load('_common', dir)[topicId] ?? [];
  return [...new Set([...own, ...common])];
}
