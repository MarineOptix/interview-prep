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
  function track(step) {
    if (!state) return;
    state.sent = state.sent || {};
    if (state.sent[step]) return;
    state.sent[step] = true;
    save();
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

  function readForm() {
    const fd = new FormData(form);
    const resume = {};
    const vacancy = {};
    const resumeKeys = ['targetPosition', 'currentRank', 'otherVesselTypes', 'yearsAtSea', 'yearsInRank', 'otherCertificates', 'englishLevel', 'marlinsScore', 'duties'];
    const vacancyKeys = ['vesselType', 'vesselSize', 'mainEngine', 'tradingArea', 'flag', 'contractLength', 'company', 'requirements'];
    resumeKeys.forEach((k) => (resume[k] = fd.get(k) ?? ''));
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
    syncDeptFields();
  }

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
