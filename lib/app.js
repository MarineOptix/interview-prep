import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPositions } from './positions.js';
import { homePage, positionPage, planPage, notFoundPage, trackPage, TRACK_STEPS } from './pages.js';
import { cleanProfile } from './form.js';
import { getTopic, TOPICS } from './topics.js';
import { generateTopic, LlmError } from './llm.js';
import { allowCall } from './ratelimit.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const CALLS_PER_HOUR = (Number(process.env.PLANS_PER_HOUR) || 5) * TOPICS.length;
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// Content is read once at start-up; restart the server after editing content/.
const positions = loadPositions();

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
}

async function readJson(req, limit = 20_000) {
  // Some hosts (Vercel) may have parsed the body already.
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function clientIp(req) {
  const real = req.headers['x-real-ip'];
  const fwd = req.headers['x-forwarded-for'];
  return (typeof real === 'string' && real) || (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket?.remoteAddress || 'unknown';
}

async function serveStatic(res, pathname) {
  const file = normalize(join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    const data = await readFile(file);
    send(res, 200, data, MIME[extname(file)] ?? 'application/octet-stream', { 'Cache-Control': 'public, max-age=300' });
    return true;
  } catch {
    return false;
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // On Vercel every page is rewritten to the single function with the original path in ?__path.
  const rewritten = url.searchParams.get('__path');
  if (rewritten !== null) {
    url.searchParams.delete('__path');
    url.pathname = rewritten.startsWith('/') ? rewritten : `/${rewritten}`;
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET') {
    if (path === '/') return send(res, 200, homePage(positions));
    if (path === '/health') return sendJson(res, 200, { ok: true });
    if (path === '/plan') return send(res, 200, planPage(positions, url.searchParams.get('position')));
    const m = path.match(/^\/positions\/([a-z0-9-]+)$/);
    if (m) {
      const position = positions.find((p) => p.slug === m[1]);
      return position ? send(res, 200, positionPage(position)) : send(res, 404, notFoundPage());
    }
    const step = path.match(/^\/t\/([a-z-]+)$/);
    if (step && TRACK_STEPS.includes(step[1])) {
      return send(res, 200, trackPage(step[1]), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
    }
    if (await serveStatic(res, path)) return;
    return send(res, 404, notFoundPage());
  }

  if (req.method === 'POST' && (path === '/api/validate' || path === '/api/generate')) {
    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: 'The request could not be read.' });
    }
    const { profile, errors } = cleanProfile(body.input, positions);
    if (errors.length) return sendJson(res, 422, { errors });
    if (path === '/api/validate') return sendJson(res, 200, { ok: true });

    const topic = getTopic(body.topicId);
    if (!topic) return sendJson(res, 400, { error: 'Unknown topic.' });
    if (!allowCall(clientIp(req), CALLS_PER_HOUR)) {
      return sendJson(res, 429, { error: 'You have built several plans in the last hour. Try again later.' });
    }
    try {
      const questions = await generateTopic(topic, profile);
      return sendJson(res, 200, { topicId: topic.id, questions });
    } catch (err) {
      const status = err instanceof LlmError ? err.status : 500;
      console.error(`[generate:${topic.id}]`, err.message);
      return sendJson(res, status, { error: status === 500 ? 'The plan could not be written. Try again.' : err.message });
    }
  }

  send(res, 405, 'Method not allowed', 'text/plain');
}

/** Request handler shared by the standalone server (server.js) and the Vercel function (api/index.js). */
export default async function handle(req, res) {
  try {
    await route(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'Server error', 'text/plain');
  }
}

export { positions };
