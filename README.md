# Interview Prep

Interview preparation for seafarers: a landing page with hand-written questions for 17 ranks, and a personal plan of 17 questions with model answers, generated from the candidate’s service record and the vacancy.

Separate from the live interview assistant (`MarineOptix/interview`), which is paused.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
cp .env.example .env      # add GROQ_API_KEY, or set MOCK_LLM=1 to work on the UI without the API; DATA_DIR=./data keeps the database in the project folder
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

### Question bank — `content/question-bank/*.md`

Typical interview questions the plan is built from. `_common.md` holds questions for every rank; `<slug>.md` adds rank-specific ones. Format: a `## <topic-id>` heading (`motivation`, `experience`, `conventions`, `safety`, `technical`, `leadership`, `contract`), then one question per `- ` line. For each topic the model picks the questions that fit the vacancy best and adapts the wording. To add a question, add a line; no code changes needed.

### Knowledge base — `content/knowledge-base/*.md`

General maritime reference that grounds the AI answers. Each plan topic reads specific files (see `lib/topics.js`); `technical` resolves to `technical-deck.md`, `technical-engine.md` or `technical-catering.md` by the rank’s department. Facts about the candidate come only from the form.

## Filling the form from documents

The form can be filled from a CV (PDF) and from a job advert (PDF, link or pasted text); typing by hand always works too.

1. A PDF is read **in the browser** with PDF.js (`public/vendor/pdfjs`, loaded only when a file is chosen). The file itself is never uploaded. Scanned PDFs have no text and are refused with a message.
2. Obvious identifiers are removed in the browser: emails, phone numbers, document numbers, date of birth.
3. The text goes to `POST /api/extract`, which asks the model to map it onto the form fields (`lib/extract.js`). The model is told to copy nothing personal and no vessel names. Its output is whitelisted and length-limited before it reaches the page.
4. A link is fetched by the server (`fetchPageText`): only public http(s) hosts, every redirect re-checked, 8 s and 1 MB limits. Pages behind a login cannot be read; the visitor is asked to paste the text.
5. Filled fields are marked yellow for the visitor to check before building the plan.

Nothing is stored on the server. The site tells visitors this and asks them to remove personal details first if they worry about a leak. To make "not stored" hold for the AI provider too, turn on **Zero Data Retention** in the Groq console (Settings → Data Controls).

## How a plan is generated

1. The browser posts the form to `/api/validate`. The name field is never sent; it stays in the browser and appears only on the plan and PDF.
2. The browser then calls `/api/generate` once per topic (7 topics, `lib/topics.js`), one after another, and shows each topic as it arrives.
3. Each call sends Groq the system rules (resume is the only source of facts, gaps become `[placeholders]`), the topic brief, the cleaned profile and the topic’s knowledge-base files, and asks for JSON (`lib/prompt.js`, `lib/llm.js`).
4. The finished plan is kept in `sessionStorage` so a page reload does not lose it. Nothing is stored on the server.
5. “Save as PDF” opens the browser’s print dialog with a print stylesheet.

Limits: `PLANS_PER_HOUR` per IP (in memory, resets on restart).

## Voice rehearsal (PassMuster): the foundation

The voice rehearsal is being built in stages on top of this site. What is in place so far has no page of its own yet.

### Model and speech layers — `lib/ai/`

The product calls two functions and does not know which provider answers.

- `askJson(request)` in `lib/ai/llm.js` sends messages (and a recorded answer, if there is one) and returns checked JSON. `request.use` says what the call is for: `text` is the written plan and CV reading (Groq by default, Gemini with `TEXT_PROVIDER=gemini`); `turn`, `plan` and `report` are the three calls of a rehearsal (Gemini). It retries once on network errors, server errors and unusable answers, never on a rejected request, and writes nothing from the messages or answers to the log: a provider's error is logged as its code and message only, with keys removed.
- `synthesize(text)` in `lib/ai/speech.js` returns audio, or `null` when the browser should read the line itself: `SPEECH_PROVIDER=browser`, no Gemini key, the provider over its limit, or a failed call. The voice never stops a rehearsal.

Models, the Gemini address and keys come from the environment (see `.env.example`).

### Database — `lib/db.js`

One SQLite file, `passmuster.db`, in `DATA_DIR`, through the SQLite module built into Node 22 (it prints an "experimental" warning at start). Three tables: `access` (codes and their counters), `sessions` (code, rank, start and end time, number of answers, status), `payments` (empty until online payment is connected). No conversation, recording or report is stored. Once a day the file is copied to `DATA_DIR/backup`; the newest seven copies are kept.

### Access codes — `lib/access.js`, `scripts/codes.js`

A rehearsal is opened by a code, without accounts. A code has a number of rehearsals and, optionally, an end date. One rehearsal is taken off the code when the third answer arrives, so a failed microphone check costs nothing. To keep that from becoming an endless supply of free two-answer rehearsals, a code gets at most five such free starts in 24 hours.

```bash
npm run codes -- create --count 10 --rehearsals 3 --days 30 --note "first testers"
npm run codes -- list
```

The command works on the database in `DATA_DIR`, so it must run where that file is.

### Payments — `lib/payments/`

Designed now, connected later. A payment provider is a module with two operations: `createPayment` (returns the address of the payment page) and `handleNotification` (checks the provider's signature, then calls `applyPayment`, which adds rehearsals to a code; a repeated notification changes nothing). The only provider today is `manual`: no online payment, codes are issued with the command above.

## Deploy

### Vercel (current)

`vercel.json` serves `public/` as static files and rewrites every other path to one Node function, `api/index.js`, which runs the same handler as the local server (`lib/app.js`). No build step.

1. vercel.com → **Add New → Project** → import `MarineOptix/interview-prep`.
2. Framework preset: **Other**. Leave build and output settings as they are (they come from `vercel.json`).
3. Environment variables: `GROQ_API_KEY` (required), optionally `GROQ_MODEL`, `PLANS_PER_HOUR`, and `CONTACT_TELEGRAM` / `CONTACT_EMAIL` to show the owner's contacts in the footer of every page.
4. **Deploy**. Every push to `main` deploys again.

Limits to know: each function call may run up to 60 s (`maxDuration`), enough for one topic. The per-IP limit lives in memory of a function instance, so on Vercel it is approximate.

### Visitor counters

Vercel Web Analytics (free plan: page views only, no cookies). Turn it on once: Vercel → project → **Analytics → Enable**, then redeploy. Every page includes the analytics script when running on Vercel.

The free plan has no custom events, so funnel steps are counted as page views of tiny pages loaded in a hidden frame, once per plan:

| Path in the Pages panel | Meaning |
| --- | --- |
| `/` and `/positions/...` | landing and rank pages |
| `/plan` | opened the plan form |
| `/t/cv-imported` | filled the form from a CV |
| `/t/vacancy-imported` | filled the form from a job advert |
| `/t/plan-started` | submitted the form |
| `/t/plan-ready` | all 7 topics were written |
| `/t/pdf-saved` | pressed "Save as PDF" |

### Amvera

`amvera.yml` tells Amvera to run Node 22 with `npm start` on port 3000 and to mount persistent storage at `/data`. Amvera runs `npm install` itself during the build phase.

1. amvera.ru → new project → connect this repository (or push to the Amvera git remote).
2. Add the environment variables in the project settings: `GROQ_API_KEY`, `GEMINI_API_KEY`, and for the server check below `CHECK_TOKEN`. `DATA_DIR` can stay unset: it defaults to `/data`, the folder Amvera keeps across restarts and rebuilds.
3. Deploy, then open `/health`: it answers `{"ok":true}`.

### Server check

Answers two questions: can this server reach the AI providers the voice rehearsal needs, and does its database open?

It makes five small calls: Gemini text with JSON output, Gemini speech synthesis, Gemini audio input (it listens to the speech it has just synthesised), a short Gemini conversation sent the way a rehearsal turn will be (system instruction, earlier turns, a schema), and Groq text. Every Gemini request is sent with `store: false`, so Google does not keep it.

- On a deployed server: set `CHECK_TOKEN` to a random string of 16 or more characters and open `/check-providers?token=<that string>`. The page answers with JSON: one entry per call with `ok`, the time in milliseconds, the HTTP status and a short detail, and a `storage` entry with the date the database was first created, the number of codes and sessions, and the number of daily copies. Without the right token the page answers 404, and it runs at most once in 30 seconds. Remove `CHECK_TOKEN` when the check is done.
- On your own computer: `npm run check:providers` prints the provider part as text.

API keys and access codes never appear in the result. The Gemini calls decide whether the check passes; the Groq call only shows whether the text plan can keep using Groq from this server.

### Moving to another server

Nothing in the code is specific to Amvera. To move: copy the file `passmuster.db` from the old `DATA_DIR` to the new one, set the same environment variables, and start with `npm start`. On a server in a country where the Gemini API is offered, leave `GEMINI_BASE_URL` empty.

### Render or any Node host

`render.yaml` is a ready Render Blueprint (Render may ask for a payment card even on the free plan). Any other host: Node 22, start command `npm start`, health check `GET /health`, same environment variables, requests of at least 90 s allowed.

## Layout

```
server.js                 local / standalone server
api/index.js              Vercel function entry
lib/app.js                routes and API (shared)
lib/positions.js          loads content/positions
lib/pages.js              HTML for all pages
lib/form.js               form options and server-side validation
lib/topics.js             plan topics, question counts, knowledge files
lib/prompt.js             LLM prompt
lib/llm.js                written plan: one model call per topic, output checks, mock mode
lib/ai/                   model layer (llm.js, groq.js, gemini.js) and speech layer (speech.js, gemini-tts.js)
lib/db.js                 SQLite database of access codes and counters
lib/backup.js             daily copy of the database
lib/access.js             access codes, rehearsal sessions, charging
lib/payments/             payment provider interface and the manual provider
lib/knowledge.js          knowledge-base loader
lib/question-bank.js      question-bank loader
lib/extract.js            reads CVs and job adverts into form fields
lib/provider-check.js     checks Gemini and Groq from this server
scripts/                  check-providers.js (provider check), codes.js (access codes)
amvera.yml                Amvera deployment settings
public/                   styles.css, plan.js, favicon
content/                  positions and knowledge base
test/                     unit tests (node --test)
```
