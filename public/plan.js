(() => {
  const form = document.getElementById('plan-form');
  const result = document.getElementById('result');
  const errorsBox = document.getElementById('form-errors');
  const topics = window.TOPICS;
  const STORE_KEY = 'interview-prep:plan';

  let state = null; // { name, input, title, results: { [topicId]: { questions } | { error } } }

  // ---------- storage (session only; never required) ----------
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  }
  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
  }

  // ---------- funnel counters ----------
  // Each step is counted once per plan by loading a tiny page in a hidden frame (see TRACK_STEPS on the server).
  const pageSent = {}; // steps counted before a plan exists (document imports)
  function track(step) {
    const bag = state ? (state.sent = state.sent || {}) : pageSent;
    if (bag[step]) return;
    bag[step] = true;
    if (state) save();
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.src = `/t/${step}`;
    document.body.append(frame);
    setTimeout(() => frame.remove(), 15000);
  }

  // ---------- form ----------
  const positionSelect = form.elements.targetPosition;
  function syncDeptFields() {
    const dept = positionSelect.selectedOptions[0]?.dataset.dept;
    form.querySelectorAll('[data-dept-only]').forEach((el) => {
      el.hidden = el.dataset.deptOnly !== dept;
    });
  }
  positionSelect.addEventListener('change', syncDeptFields);
  syncDeptFields();

  // "Current or last rank": a list of ranks, with a text field only for "Other rank".
  const rankSelect = form.elements.currentRankChoice;
  const rankOther = form.elements.currentRankOther;
  const rankOtherWrap = document.getElementById('currentRankOtherWrap');
  function syncRankOther() {
    rankOtherWrap.hidden = rankSelect.value !== 'other';
  }
  rankSelect.addEventListener('change', () => {
    syncRankOther();
    if (rankSelect.value === 'other') rankOther.focus();
  });
  function readRank() {
    return rankSelect.value === 'other' ? rankOther.value.trim() : rankSelect.value;
  }
  function fillRank(value) {
    const known = [...rankSelect.options].some((o) => o.value === value && value !== 'other');
    rankSelect.value = known ? value : value ? 'other' : '';
    rankOther.value = known ? '' : value || '';
    syncRankOther();
  }

  function readForm() {
    const fd = new FormData(form);
    const resume = {};
    const vacancy = {};
    const resumeKeys = ['targetPosition', 'otherVesselTypes', 'yearsAtSea', 'yearsInRank', 'otherCertificates', 'englishLevel', 'marlinsScore', 'seaService', 'duties'];
    const vacancyKeys = ['vesselType', 'vesselSize', 'mainEngine', 'tradingArea', 'contractLength', 'company', 'requirements'];
    resumeKeys.forEach((k) => (resume[k] = fd.get(k) ?? ''));
    resume.currentRank = readRank();
    resume.vesselTypes = fd.getAll('vesselTypes');
    resume.certificates = fd.getAll('certificates');
    vacancyKeys.forEach((k) => (vacancy[k] = fd.get(k) ?? ''));
    // The name field is deliberately not part of the payload.
    return { input: { resume, vacancy }, name: (fd.get('name') || '').trim() };
  }

  function fillForm(input, name) {
    const set = (key, value) => {
      const el = form.elements[key];
      if (el && typeof value === 'string') el.value = value;
    };
    Object.entries(input.resume).forEach(([k, v]) => set(k, v));
    Object.entries(input.vacancy).forEach(([k, v]) => set(k, v));
    form.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      const list = input.resume[cb.name] || [];
      cb.checked = list.includes(cb.value);
    });
    set('name', name || '');
    fillRank(input.resume.currentRank || '');
    syncDeptFields();
  }

  // ---------- filling the form from a CV or a job advert ----------
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_PAGES = 20;
  const MAX_TEXT = 24000;

  let pdfjsPromise = null;
  function loadPdfjs() {
    // The PDF reader is large, so it is fetched only when someone picks a file.
    pdfjsPromise = pdfjsPromise || import('/vendor/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      return lib;
    });
    return pdfjsPromise;
  }

  /** Reads the text of a PDF in the browser. The file itself is never uploaded. */
  async function pdfText(file) {
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      let line = '';
      let lastY = null;
      const lines = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform ? item.transform[5] : lastY;
        if (lastY !== null && Math.abs(y - lastY) > 2 && line.trim()) {
          lines.push(line.trim());
          line = '';
        }
        line += item.str + (item.hasEOL ? '' : ' ');
        if (item.hasEOL) {
          if (line.trim()) lines.push(line.trim());
          line = '';
        }
        lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      pages.push(lines.join('\n'));
    }
    return pages.join('\n\n');
  }

  /** Removes the identifiers that are easy to spot before the text leaves the browser. */
  function redact(text) {
    return text
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email removed]')
      .replace(/\+\d[\d\s().-]{7,}\d/g, '[phone removed]')
      // Document numbers such as AB1234567 (passport, seaman's book, certificates, IMO numbers).
      .replace(/\b[A-Z]{1,3}[\s-]?\d{6,9}\b/g, '[number removed]')
      .replace(/(date of birth|d\.o\.b\.?|born)([^\n\d]{0,15})\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/gi, '$1$2[date removed]');
  }

  function markFilled(el) {
    el.classList.add('filled');
    el.addEventListener('input', () => el.classList.remove('filled'), { once: true });
    el.addEventListener('change', () => el.classList.remove('filled'), { once: true });
  }

  /** Puts extracted values into the form without wiping what the person already typed. Returns how many fields changed. */
  function applyFields(fields) {
    let count = 0;
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        form.querySelectorAll(`input[type=checkbox][name="${key}"]`).forEach((cb) => {
          if (value.includes(cb.value) && !cb.checked) {
            cb.checked = true;
            markFilled(cb.closest('.check'));
            count++;
          }
        });
        continue;
      }
      if (!value) continue;
      if (key === 'currentRank') {
        fillRank(value);
        markFilled(rankSelect);
        if (rankSelect.value === 'other') markFilled(rankOther);
        count++;
        continue;
      }
      const el = form.elements[key];
      if (!el) continue;
      // The rank chosen on the landing page wins over what a document says.
      if (key === 'targetPosition' && el.value) continue;
      el.value = value;
      if (el.value !== String(value)) continue; // a select without that option
      markFilled(el);
      count++;
    }
    syncDeptFields();
    return count;
  }

  const importing = { cv: false, vacancy: false };
  async function importDocument(kind, getPayload) {
    if (importing[kind]) return;
    const status = document.getElementById(kind === 'cv' ? 'cvStatus' : 'vacancyStatus');
    const say = (text, isError = false) => {
      status.textContent = text;
      status.classList.toggle('is-error', isError);
    };
    importing[kind] = true;
    try {
      say('Reading…');
      const payload = await getPayload();
      if (!payload) return;
      say('Filling in the form…');
      const res = await post('/api/extract', { kind, ...payload }).catch(() => ({ ok: false, data: { error: 'No connection. Check your internet and try again.' } }));
      if (!res.ok) return say(res.data.error || 'This could not be read. Fill in the form by hand.', true);
      const count = applyFields(res.data.fields || {});
      if (!count) return say('Nothing useful was found. Fill in the form by hand.', true);
      track(kind === 'cv' ? 'cv-imported' : 'vacancy-imported');
      say(`Filled in ${count} ${count === 1 ? 'field' : 'fields'}, marked in yellow. Check them and add what is missing.`);
    } catch (err) {
      say('This file could not be read. Fill in the form by hand.', true);
    } finally {
      importing[kind] = false;
      if (status.textContent === 'Reading…' || status.textContent === 'Filling in the form…') say('');
    }
  }

  function pdfPayload(kind, input) {
    return async () => {
      const file = input.files[0];
      input.value = ''; // allow choosing the same file again
      const status = document.getElementById(kind === 'cv' ? 'cvStatus' : 'vacancyStatus');
      const fail = (text) => {
        status.textContent = text;
        status.classList.add('is-error');
        return null;
      };
      if (!file) return null;
      if (file.size > MAX_FILE_BYTES) return fail('This file is larger than 15 MB. Use a smaller PDF or fill in the form by hand.');
      const text = redact(await pdfText(file));
      if (text.replace(/\s/g, '').length < 150) {
        return fail('This PDF has no text inside (it looks like a scan or photo). Fill in the form by hand, or upload a PDF saved from Word.');
      }
      return { text: text.slice(0, MAX_TEXT) };
    };
  }

  const cvFile = document.getElementById('cvFile');
  cvFile.addEventListener('change', () => importDocument('cv', pdfPayload('cv', cvFile)));
  const vacancyFile = document.getElementById('vacancyFile');
  vacancyFile.addEventListener('change', () => importDocument('vacancy', pdfPayload('vacancy', vacancyFile)));

  const vacancyUrl = document.getElementById('vacancyUrl');
  function readLink() {
    const url = vacancyUrl.value.trim();
    if (url) importDocument('vacancy', async () => ({ url }));
  }
  document.getElementById('vacancyUrlButton').addEventListener('click', readLink);
  vacancyUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Enter here reads the link, it must not submit the whole form
      readLink();
    }
  });
  document.getElementById('vacancyTextButton').addEventListener('click', () => {
    const text = document.getElementById('vacancyText').value.trim();
    if (text) importDocument('vacancy', async () => ({ text: redact(text).slice(0, MAX_TEXT) }));
  });

  function showErrors(errors) {
    errorsBox.replaceChildren();
    if (!errors.length) {
      errorsBox.hidden = true;
      return;
    }
    const p = el('p', {}, 'Fix these before building the plan:');
    const ul = el('ul', {}, errors.map((e) => el('li', {}, e)));
    errorsBox.append(p, ul);
    errorsBox.hidden = false;
    errorsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { input, name } = readForm();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    const check = await post('/api/validate', { input }).catch(() => ({ ok: false, data: { errors: ['No connection. Check your internet and try again.'] } }));
    button.disabled = false;
    if (!check.ok) return showErrors(check.data.errors || [check.data.error || 'Something went wrong. Try again.']);
    showErrors([]);

    const position = positionSelect.selectedOptions[0]?.textContent || '';
    const vesselType = input.vacancy.vesselType;
    state = { name, input, title: `${position}, ${vesselType.toLowerCase()}`, results: {} };
    save();
    track('plan-started');
    showResult();
    generateMissing();
  });

  // ---------- result ----------
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    [].concat(children).forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(c)));
    return node;
  }

  /** Text with [placeholders] highlighted so the candidate sees what to fill in. */
  function withGaps(text) {
    const frag = document.createDocumentFragment();
    text.split(/(\[[^\]\n]{1,200}\])/).forEach((part) => {
      if (/^\[.*\]$/.test(part)) frag.append(el('mark', { class: 'gap' }, part));
      else if (part) frag.append(part);
    });
    return frag;
  }

  function renderQuestion(q, n) {
    return el('article', { class: 'q' }, [
      el('h3', {}, [el('span', { class: 'q-num' }, `${n}.`), ' ', q.question]),
      q.whyAsked ? el('p', { class: 'why' }, q.whyAsked) : null,
      el('div', { class: 'answer prose' }, q.answer.split(/\n{2,}/).map((p) => el('p', {}, withGaps(p)))),
      q.keyPoints?.length
        ? el('div', { class: 'points' }, [el('p', { class: 'points-title' }, 'Remember'), el('ul', {}, q.keyPoints.map((p) => el('li', {}, withGaps(p))))])
        : null,
      q.followUp ? el('p', { class: 'follow' }, [el('strong', {}, 'Possible follow-up: '), q.followUp]) : null,
    ]);
  }

  function renderTopic(topic, startNum) {
    const r = state.results[topic.id];
    const section = el('section', { class: 'topic', id: `topic-${topic.id}` }, [el('h2', {}, topic.title)]);
    if (!r) {
      section.classList.add('pending');
      section.append(el('p', { class: 'status' }, 'Writing…'));
    } else if (r.error) {
      section.classList.add('failed');
      section.append(
        el('p', { class: 'status' }, r.error),
        el('button', { class: 'button secondary', type: 'button', onclick: () => retry(topic.id) }, 'Try this topic again')
      );
    } else {
      r.questions.forEach((q, i) => section.append(renderQuestion(q, startNum + i)));
    }
    return section;
  }

  function showResult() {
    form.hidden = true;
    result.hidden = false;
    const total = topics.length;
    const pending = topics.filter((t) => !state.results[t.id]).length;
    const done = total - pending;

    const header = el('header', { class: 'result-head' }, [
      el('h1', {}, state.name ? `Interview plan for ${state.name}` : 'Your interview plan'),
      el('p', { class: 'lead' }, state.title),
      el('p', { class: 'hint' }, 'Words in highlighted [brackets] are gaps for your own details. Fill them in before the interview.'),
      el('div', { class: 'actions no-print' }, [
        el('button', { class: 'button', type: 'button', onclick: () => { track('pdf-saved'); window.print(); }, ...(pending ? { disabled: '' } : {}) }, 'Save as PDF'),
        el('button', { class: 'button secondary', type: 'button', onclick: editForm }, 'Change my details'),
        el('button', { class: 'button secondary', type: 'button', onclick: startOver }, 'Start a new plan'),
      ]),
      pending ? el('p', { class: 'progress no-print' }, `Writing topic ${done + 1} of ${total}…`) : null,
    ]);

    let n = 1;
    const sections = topics.map((t) => {
      const s = renderTopic(t, n);
      n += state.results[t.id]?.questions?.length || 0;
      return s;
    });
    result.replaceChildren(header, ...sections);
  }

  function editForm() {
    fillForm(state.input, state.name);
    result.hidden = true;
    form.hidden = false;
    window.scrollTo({ top: 0 });
  }

  function startOver() {
    try { sessionStorage.removeItem(STORE_KEY); } catch {}
    window.location.href = '/plan';
  }

  let runningFor = null; // the plan object a generation loop is working on
  async function generateMissing() {
    const plan = state;
    if (runningFor === plan) return;
    runningFor = plan;
    let topic;
    // Pick the next unwritten topic each time, so a retried topic is picked up by a running loop.
    while ((topic = topics.find((t) => !plan.results[t.id]))) {
      const res = await post('/api/generate', { input: plan.input, topicId: topic.id }).catch(() => ({ ok: false, data: { error: 'No connection. Check your internet.' } }));
      if (plan !== state) return; // the person started a different plan meanwhile
      plan.results[topic.id] = res.ok ? { questions: res.data.questions } : { error: res.data.error || (res.data.errors || []).join(' ') || 'This topic could not be written.' };
      if (res.status === 429) {
        // Rate limited: mark the remaining topics so the person can retry them later.
        topics.filter((t) => !plan.results[t.id]).forEach((t) => (plan.results[t.id] = { error: res.data.error }));
      }
      save();
      if (!result.hidden) showResult();
    }
    if (runningFor === plan) runningFor = null;
    if (plan === state && topics.every((t) => plan.results[t.id]?.questions)) track('plan-ready');
  }

  function retry(topicId) {
    delete state.results[topicId];
    save();
    showResult();
    generateMissing();
  }

  // ---------- restore ----------
  const saved = load();
  if (saved?.input && saved.results) {
    state = saved;
    // Topics interrupted by a reload are written again.
    showResult();
    generateMissing();
  }
})();
