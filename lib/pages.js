import { html, raw } from './html.js';
import { DEPARTMENTS } from './positions.js';
import { VESSEL_TYPES, CERTIFICATES, ENGLISH_LEVELS } from './form.js';
import { TOPICS } from './topics.js';

const SITE = 'Interview Prep';
const TOTAL_QUESTIONS = TOPICS.reduce((n, t) => n + t.count, 0);

// Vercel Web Analytics (cookie-free page views). The script only exists on Vercel, so it is skipped elsewhere.
const ANALYTICS = process.env.VERCEL
  ? raw(`<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>`)
  : '';

/**
 * Funnel steps counted as page views. The free analytics plan has no custom events,
 * so the plan page loads one of these tiny pages in a hidden frame when a step happens.
 */
export const TRACK_STEPS = ['plan-started', 'plan-ready', 'pdf-saved'];

export function trackPage(step) {
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${step}</title>${ANALYTICS}</head><body></body></html>`.toString();
}

function bluePeter(cls = '') {
  return raw(`<svg class="flag ${cls}" viewBox="0 0 300 200" role="img" aria-label="Signal flag P, the Blue Peter">
    <rect width="300" height="200" fill="var(--signal-blue)"/>
    <rect x="100" y="66.7" width="100" height="66.6" fill="#fff"/>
  </svg>`);
}

export function layout({ title, description = '', body, bodyClass = '' }) {
  const pageTitle = title ? `${title} | ${SITE}` : `${SITE} for seafarers`;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${description}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,400..800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<link rel="stylesheet" href="/styles.css">
${ANALYTICS}
</head>
<body class="${bodyClass}">
<header class="site-header">
  <a class="brand" href="/">${bluePeter('flag-mini')}<span>${SITE}</span></a>
</header>
<main>${body}</main>
<footer class="site-footer">
  <p>Free while we test the idea. Model answers are a starting point: check facts and regulations against your company’s procedures.</p>
</footer>
</body>
</html>`.toString();
}

export function homePage(positions) {
  const columns = DEPARTMENTS.map((d) => {
    const items = positions.filter((p) => p.department === d.id);
    return html`<section class="dept">
      <h3>${d.label}</h3>
      <ul>${items.map(
        (p) => html`<li><a href="/positions/${p.slug}"><span>${p.title}</span>${
          p.questions.length ? '' : html`<small>soon</small>`
        }</a></li>`
      )}</ul>
    </section>`;
  });

  return layout({
    description: 'Interview questions with model answers for deck, engine and catering ranks, and a personal preparation plan built from your sea service.',
    body: html`
<section class="hero">
  <figure class="hero-flag">
    ${bluePeter()}
    <figcaption>Flag P, the Blue Peter: all persons report on board, the vessel is about to sail.</figcaption>
  </figure>
  <div class="hero-text">
    <h1>Your interview, prepared.</h1>
    <p class="lead">Pick your rank to read interview questions with model answers. Then get a full plan of ${TOTAL_QUESTIONS} questions written around your own sea service and the vacancy you are applying for.</p>
    <a class="button" href="#ranks">Choose your rank</a>
  </div>
</section>

<section class="ranks" id="ranks" aria-labelledby="ranks-title">
  <h2 id="ranks-title">Choose your rank</h2>
  <div class="dept-grid">${columns}</div>
</section>

<section class="how" aria-labelledby="how-title">
  <h2 id="how-title">How the plan is made</h2>
  <ol class="steps">
    <li><strong>Tell us about your service.</strong> Rank, vessel types, certificates and what you did on board. Your name stays in your browser.</li>
    <li><strong>Add the vacancy.</strong> Vessel type, trading area, flag, contract and anything special from the job advert.</li>
    <li><strong>Get your plan.</strong> ${TOTAL_QUESTIONS} questions across ${TOPICS.length} topics, from motivation to regulations and emergencies, with answers built only from facts you gave. Save it as a PDF.</li>
  </ol>
</section>`,
  });
}

export function positionPage(position) {
  const qs = position.questions;
  return layout({
    title: `${position.title} interview questions`,
    description: `Interview questions and model answers for ${position.title}.`,
    body: html`
<article class="position">
  <p class="crumbs"><a href="/#ranks">All ranks</a></p>
  <h1>${position.title} interview questions</h1>
  ${
    qs.length
      ? html`<p class="lead">${qs.length} questions crewing managers often ask at this rank, with model answers.${qs.some((q) => q.answerHtml.includes('class="gap"')) ? ' Words in [brackets] are for your own details.' : ''}</p>
  <div class="qa-list">${qs.map(
    (q, i) => html`<details class="qa" ${i === 0 ? raw('open') : ''}>
      <summary>${q.question}</summary>
      <div class="answer prose">${raw(q.answerHtml)}</div>
    </details>`
  )}</div>`
      : html`<p class="lead">Questions for this rank are being written. You can already get a personal plan below.</p>`
  }
  <aside class="cta">
    <h2>Get a plan for your next interview</h2>
    <p>${TOTAL_QUESTIONS} questions with answers built around your own experience and the vacancy. Free while we test the idea.</p>
    <a class="button" href="/plan?position=${position.slug}">Build my plan</a>
  </aside>
</article>`,
  });
}

function options(list, selected) {
  return list.map((v) => html`<option value="${v}" ${v === selected ? raw('selected') : ''}>${v}</option>`);
}

function checkboxes(name, list) {
  return html`<div class="checks">${list.map(
    (v) => html`<label class="check"><input type="checkbox" name="${name}" value="${v}"><span>${v}</span></label>`
  )}</div>`;
}

export function planPage(positions, selectedSlug) {
  const byDept = DEPARTMENTS.map(
    (d) => html`<optgroup label="${d.label}">${positions
      .filter((p) => p.department === d.id)
      .map((p) => html`<option value="${p.slug}" data-dept="${p.department}" ${p.slug === selectedSlug ? raw('selected') : ''}>${p.title}</option>`)}</optgroup>`
  );

  // Same ranks for "current or last rank"; the value is the rank title itself.
  const ranksByDept = DEPARTMENTS.map(
    (d) => html`<optgroup label="${d.label}">${positions
      .filter((p) => p.department === d.id)
      .map((p) => html`<option value="${p.title}">${p.title}</option>`)}</optgroup>`
  );

  return layout({
    title: 'Build your interview plan',
    bodyClass: 'plan-page',
    body: html`
<div class="plan">
<form id="plan-form" class="plan-form" novalidate>
  <h1>Build your interview plan</h1>
  <p class="lead">Answers are built only from what you write here, so be specific. Where a detail is missing, the plan leaves a gap in [brackets] for you to fill in.</p>

  <div id="form-errors" class="form-errors" role="alert" hidden></div>

  <fieldset>
    <legend>Your service</legend>
    <div class="field">
      <label for="targetPosition">Rank you are applying for</label>
      <select id="targetPosition" name="targetPosition" required>
        <option value="">Choose a rank</option>${byDept}
      </select>
    </div>
    <div class="field">
      <label for="currentRank">Current or last rank</label>
      <select id="currentRank" name="currentRankChoice" required>
        <option value="">Choose a rank</option>${ranksByDept}
        <option value="other">Other rank</option>
      </select>
      <div id="currentRankOtherWrap" class="sub-field" hidden>
        <label class="sub" for="currentRankOther">Your rank</label>
        <input id="currentRankOther" name="currentRankOther" maxlength="120" placeholder="e.g. Fitter, Pumpman, Junior Officer">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="yearsAtSea">Total sea service, years</label>
        <input id="yearsAtSea" name="yearsAtSea" type="number" min="0" max="60" step="0.5" inputmode="decimal" required>
      </div>
      <div class="field">
        <label for="yearsInRank">Time in current rank, years</label>
        <input id="yearsInRank" name="yearsInRank" type="number" min="0" max="60" step="0.5" inputmode="decimal">
      </div>
    </div>
    <div class="field">
      <span class="label" id="vesselTypes-label">Vessel types you have served on</span>
      ${checkboxes('vesselTypes', VESSEL_TYPES)}
      <label class="sub" for="otherVesselTypes">Other</label>
      <input id="otherVesselTypes" name="otherVesselTypes" maxlength="120">
    </div>
    <div class="field">
      <span class="label">Certificates</span>
      ${checkboxes('certificates', CERTIFICATES)}
      <label class="sub" for="otherCertificates">Other certificates and endorsements</label>
      <input id="otherCertificates" name="otherCertificates" maxlength="400" placeholder="e.g. CoC II/1, Panama endorsement">
    </div>
    <div class="field-row">
      <div class="field">
        <label for="englishLevel">English</label>
        <select id="englishLevel" name="englishLevel"><option value="">Not stated</option>${options(ENGLISH_LEVELS)}</select>
      </div>
      <div class="field">
        <label for="marlinsScore">Marlins test score, % <span class="opt">optional</span></label>
        <input id="marlinsScore" name="marlinsScore" type="number" min="0" max="100" inputmode="numeric">
      </div>
    </div>
    <div class="field">
      <label for="duties">Duties and achievements</label>
      <textarea id="duties" name="duties" rows="7" maxlength="2500" required
        placeholder="What you were responsible for, equipment you worked with, operations you led, inspections passed, problems you solved. Real examples make the best answers."></textarea>
    </div>
    <div class="field">
      <label for="name">Your name <span class="opt">optional</span></label>
      <input id="name" name="name" maxlength="80" autocomplete="name" data-local-only>
      <p class="hint">Stays in your browser and appears only on your plan and PDF. It is not sent anywhere.</p>
    </div>
  </fieldset>

  <fieldset>
    <legend>The vacancy</legend>
    <div class="field">
      <label for="vesselType">Vessel type</label>
      <select id="vesselType" name="vesselType" required><option value="">Choose a vessel type</option>${options(VESSEL_TYPES)}<option value="Other">Other</option></select>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="vesselSize">Size <span class="opt">optional</span></label>
        <input id="vesselSize" name="vesselSize" maxlength="120" placeholder="e.g. 50,000 DWT">
      </div>
      <div class="field" data-dept-only="engine">
        <label for="mainEngine">Main engine <span class="opt">optional</span></label>
        <input id="mainEngine" name="mainEngine" maxlength="120" placeholder="e.g. MAN B&amp;W 6S50ME-C">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="tradingArea">Trading area <span class="opt">optional</span></label>
        <input id="tradingArea" name="tradingArea" maxlength="120" placeholder="e.g. worldwide, Baltic, Persian Gulf">
      </div>
      <div class="field">
        <label for="flag">Flag <span class="opt">optional</span></label>
        <input id="flag" name="flag" maxlength="120">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="contractLength">Contract length <span class="opt">optional</span></label>
        <input id="contractLength" name="contractLength" maxlength="120" placeholder="e.g. 4+/-1 months">
      </div>
      <div class="field">
        <label for="company">Company <span class="opt">optional</span></label>
        <input id="company" name="company" maxlength="120">
      </div>
    </div>
    <div class="field">
      <label for="requirements">Requirements from the job advert <span class="opt">optional</span></label>
      <textarea id="requirements" name="requirements" rows="4" maxlength="2500" placeholder="Paste anything special: experience on a vessel type, certificates, visas, DP class…"></textarea>
    </div>
  </fieldset>

  <button class="button" type="submit">Build my plan</button>
  <p class="hint">Takes about a minute: each of the ${TOPICS.length} topics is written separately.</p>
</form>

<section id="result" class="result" hidden aria-live="polite"></section>
</div>
<script>window.TOPICS = ${raw(JSON.stringify(TOPICS.map(({ id, title, count }) => ({ id, title, count }))).replace(/</g, '\\u003c'))};</script>
<script src="/plan.js" defer></script>`,
  });
}

export function notFoundPage() {
  return layout({
    title: 'Page not found',
    body: html`<article class="position"><h1>Page not found</h1><p class="lead">The link may be out of date. <a href="/">Go to the list of ranks</a>.</p></article>`,
  });
}
