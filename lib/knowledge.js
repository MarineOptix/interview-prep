import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../content/knowledge-base/', import.meta.url));
const cache = new Map();

function read(name) {
  if (!cache.has(name)) {
    const path = `${DIR}${name}.md`;
    cache.set(name, existsSync(path) ? readFileSync(path, 'utf8').trim() : '');
  }
  return cache.get(name);
}

/** Returns the knowledge-base text that grounds one topic. */
export function knowledgeFor(topic, department) {
  return topic.knowledge
    .map((name) => (name === 'technical' ? `technical-${department}` : name))
    .map(read)
    .filter(Boolean)
    .join('\n\n');
}
