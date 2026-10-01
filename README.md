# Interview Prep

Interview preparation for seafarers: a landing page with hand-written questions for 17 ranks, and a personal plan of 17 questions with model answers, generated from the candidate’s service record and the vacancy.

Separate from the live interview assistant (`MarineOptix/interview`), which is paused.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
cp .env.example .env      # add GROQ_API_KEY, or set MOCK_LLM=1 to work on the UI without the API
npm run dev               # http://localhost:3000
npm test
```

No build step, no framework: a plain Node HTTP server (`server.js`) renders the pages; `public/plan.js` runs the plan form in the browser.

## Content

### Questions on the landing page — `content/positions/<slug>.md`

One file per rank, 5 questions each, written by hand. Format:

```markdown
---
title: Chief Officer
department: deck        # deck | engine | catering
order: 2                # position in the list
---

## Q: Why do you want to join our company as Chief Officer?

Answer in Markdown: paragraphs, lists, **bold**.

## Q: Next question?

Next answer.
```

A rank without questions shows “soon” on the landing page and still links to the plan builder. Content is read at start-up, so restart the server after editing (`npm run dev` restarts on save of `.js` files only).

### Knowledge base — `content/knowledge-base/*.md`

General maritime reference that grounds the AI answers. Each plan topic reads specific files (see `lib/topics.js`); `technical` resolves to `technical-deck.md`, `technical-engine.md` or `technical-catering.md` by the rank’s department. Facts about the candidate come only from the form.

## How a plan is generated

1. The browser posts the form to `/api/validate`. The name field is never sent; it stays in the browser and appears only on the plan and PDF.
2. The browser then calls `/api/generate` once per topic (7 topics, `lib/topics.js`), one after another, and shows each topic as it arrives.
3. Each call sends Groq the system rules (resume is the only source of facts, gaps become `[placeholders]`), the topic brief, the cleaned profile and the topic’s knowledge-base files, and asks for JSON (`lib/prompt.js`, `lib/llm.js`).
4. The finished plan is kept in `sessionStorage` so a page reload does not lose it. Nothing is stored on the server.
5. “Save as PDF” opens the browser’s print dialog with a print stylesheet.

Limits: `PLANS_PER_HOUR` per IP (in memory, resets on restart).

## Deploy

### Render (current)

`render.yaml` describes the service (free plan, Frankfurt, auto-deploy on every push to `main`).

1. Render dashboard → **New → Blueprint** → connect GitHub and choose `MarineOptix/interview-prep`.
2. Render asks for `GROQ_API_KEY` (marked `sync: false`, so it is never in git). Paste the key.
3. **Deploy Blueprint**. The site appears at `https://interview-prep-<suffix>.onrender.com`.

Free plan behaviour: the service sleeps after 15 minutes without visitors and the next visit waits about a minute while it wakes up. A generation in progress keeps it awake.

### Other hosts

Any host that runs Node 22: start command `npm start`, health check `GET /health`, set `GROQ_API_KEY` (and optionally `GROQ_MODEL`, `PLANS_PER_HOUR`). A plan takes 7 requests of up to ~30 s each, so the host must allow requests of at least 90 s.

## Layout

```
server.js                 routes and API
lib/positions.js          loads content/positions
lib/pages.js              HTML for all pages
lib/form.js               form options and server-side validation
lib/topics.js             plan topics, question counts, knowledge files
lib/prompt.js             LLM prompt
lib/llm.js                Groq call, retries, output checks, mock mode
lib/knowledge.js          knowledge-base loader
public/                   styles.css, plan.js, favicon
content/                  positions and knowledge base
test/                     unit tests (node --test)
```
