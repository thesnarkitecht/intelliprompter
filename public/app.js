import { parseOutline, flatten, buildRequest, readAnswers, applyHits, syncParents, finishedSections, takeSample, CHECK_EVERY_MS } from './core.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(`ip.${k}`)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(`ip.${k}`, JSON.stringify(v)); } catch { /* private mode: keep in memory only */ } },
};

const SAMPLE = `Welcome everyone and introduce yourself
Agenda for today
  Quarterly results
  Product roadmap
  Q&A
Quarterly results
  Revenue grew 20 percent
    Biggest gains in Europe
    New enterprise customers
  Thank the sales team
Product roadmap
  Launch of the mobile app
  Pricing changes
Close and thank the audience`;

let outline = store.get('outline', SAMPLE);
let items = parseOutline(outline);
let done = new Set(store.get('done', []));
let opened = new Set(store.get('opened', [])); // sections whose sub-items are showing
let shown = new Set(opened); // what's on screen, so render can animate the difference
let jevCalls = 0;
let probs = {};
let finalText = store.get('transcript', '');
let sentUpTo = finalText.length; // text before this was already checked
let interim = '';
let lastInterimSent = '';
let settings = { key: '', threshold: 70, lang: '', ...store.get('settings', {}) };
let serverKey = false;

// ---------- rendering ----------
function render(flashKeys = []) {
  syncParents(items, done);
  const leaves = flatten(items).filter(i => !i.children.length);
  const visible = list => list.flatMap(i => [i, ...(opened.has(i.key) ? visible(i.children) : [])]);
  // Next = first unfinished thing you can see: a leaf, or a section you haven't started.
  const next = visible(items).find(i => !done.has(i.key) && !(i.children.length && opened.has(i.key)));

  const tree = list => list.map((item, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--i', i);
    li.append(row(item, next, flashKeys));
    if (item.children.length) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.dataset.key = item.key;
      sub.classList.toggle('open', shown.has(item.key));
      sub.inert = !shown.has(item.key);
      const ul = document.createElement('ul');
      ul.append(...tree(item.children));
      sub.append(ul);
      li.append(sub);
    }
    return li;
  });

  const list = $('list');
  list.replaceChildren(...tree(items));
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '> list is empty. Click "Edit list" to add items.';
    list.append(li);
  }

  // Drawn in the old state above; switch to the new one next frame so the change animates.
  requestAnimationFrame(() => {
    for (const sub of list.querySelectorAll('.sub')) {
      const open = opened.has(sub.dataset.key);
      if (open === sub.classList.contains('open')) continue;
      void sub.offsetHeight; // commit the starting height so the transition runs
      sub.classList.toggle('open', open);
      sub.classList.toggle('opening', open);
      sub.inert = !open;
    }
    shown = new Set(opened);
  });

  const count = leaves.filter(i => done.has(i.key)).length;
  $('progress').textContent = `${count}/${leaves.length} DONE`;
  $('meterFill').style.width = leaves.length ? `${(count / leaves.length) * 100}%` : '0';
}

function row(item, next, flashKeys) {
  const label = document.createElement('label');
  label.className = 'item';
  if (done.has(item.key)) label.classList.add('done');
  if (item === next) label.classList.add('next');
  if (flashKeys.includes(item.key)) label.classList.add('flash');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = done.has(item.key);
  box.addEventListener('change', () => {
    const before = new Set(done);
    for (const i of flatten([item])) box.checked ? done.add(i.key) : done.delete(i.key);
    foldLater(finishedSections(items, done, before));
    save();
    render();
  });

  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = item.text;

  const prob = document.createElement('span');
  prob.className = 'prob';
  if (item.key in probs && !item.children.length) {
    prob.textContent = `${Math.round(probs[item.key] * 100)}%`;
    prob.title = 'Jev’s confidence that you started on this';
  }

  let chev = document.createElement('span');
  if (item.children.length) {
    chev = document.createElement('button');
    chev.type = 'button';
    chev.className = 'chev';
    const isOpen = opened.has(item.key);
    chev.setAttribute('aria-expanded', String(isOpen));
    chev.setAttribute('aria-label', `${isOpen ? 'Hide' : 'Show'} sub-items of ${item.text}`);
    chev.addEventListener('click', e => {
      e.preventDefault();
      opened.has(item.key) ? opened.delete(item.key) : opened.add(item.key);
      save();
      render();
    });
  }
  label.append(box, text, prob, chev);
  return label;
}

// Fold finished sections after a beat, so you see the last item get checked first.
// The arrow still reopens them.
function foldLater(keys) {
  if (!keys.length) return;
  setTimeout(() => {
    keys.forEach(k => { if (done.has(k)) opened.delete(k); });
    save();
    render();
  }, 1200);
}

function renderTranscript(interim = '') {
  const el = $('transcript');
  el.querySelector('.final').textContent = finalText;
  el.querySelector('.interim').textContent = interim ? (finalText ? ' ' : '') + interim : '';
  el.scrollTop = el.scrollHeight;
}

function save() {
  store.set('outline', outline);
  store.set('done', [...done]);
  store.set('opened', [...opened]);
  store.set('transcript', finalText);
}

const status = text => { $('status').textContent = text; };

// ---------- Jev ----------
// Every 5 s, send only the text spoken since the last check (never the whole transcript).
// No new words since the last check means no call: Jev is only used while you're talking.
let inflight = false;

async function runCheck() {
  if (inflight) return;
  const fresh = interim !== lastInterimSent ? interim : '';
  const sample = takeSample(finalText, sentUpTo, fresh);
  if (!sample) { if (recording) status(`quiet · jev waits for speech · ${jevCalls} calls`); return; }
  const { body, keys } = buildRequest(sample.text, items, done, opened);
  if (!Object.keys(keys).length) { sentUpTo = sample.sentUpTo; return; }

  inflight = true;
  status('asking jev…');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.key) headers['X-TypeSafe-Key'] = settings.key;
    jevCalls++;
    const res = await fetch('/api/check', { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || data.message || `HTTP ${res.status}`);

    sentUpTo = sample.sentUpTo;
    lastInterimSent = fresh || lastInterimSent;
    const { probs: p, newlyDone: hits } = readAnswers(data.answers, keys, settings.threshold / 100);
    Object.assign(probs, p);
    const before = new Set(done);
    const justOpened = applyHits(items, hits, done, opened);
    const finished = finishedSections(items, done, before);
    foldLater(finished);
    save();
    render([...hits, ...justOpened]);
    const checked = done.size - before.size - finished.length;
    status(checked ? `✓ ${checked} checked` : justOpened.length ? '▾ opened' : `${recording ? 'listening' : 'idle'} · ${jevCalls} jev calls`);
  } catch (e) {
    // sentUpTo isn't advanced, so the same text is retried on the next tick.
    status(`error: ${typeof e.message === 'string' ? e.message : 'request failed'}`.slice(0, 80));
    if (!settings.key && !serverKey) openSettings();
  } finally {
    inflight = false;
  }
}
setInterval(runCheck, CHECK_EVERY_MS);

function addFinal(text) {
  text = text.trim();
  if (!text) return;
  finalText = finalText ? `${finalText} ${text}` : text;
  save();
  renderTranscript();
}

// ---------- speech ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec;
let recording = false;

function setRecording(on) {
  recording = on;
  $('micBtn').setAttribute('aria-pressed', String(on));
  $('micLabel').textContent = on ? 'Stop recording' : 'Start recording';
  status(on ? 'listening' : 'idle');
}

function startRec() {
  rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = settings.lang || navigator.language || 'en-US';
  rec.onresult = e => {
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) addFinal(r[0].transcript);
      else live += r[0].transcript;
    }
    interim = live;
    renderTranscript(interim);
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      setRecording(false);
      status('microphone blocked');
    }
  };
  // Browsers end recognition after silence; keep going until the user stops.
  rec.onend = () => { if (recording) { try { rec.start(); } catch { setRecording(false); } } };
  rec.start();
  setRecording(true);
}

$('micBtn').addEventListener('click', () => {
  if (!SR) { $('speechWarn').hidden = false; $('typeInput').focus(); return; }
  if (recording) { setRecording(false); rec.stop(); interim = ''; } else startRec();
});

$('typeForm').addEventListener('submit', e => {
  e.preventDefault();
  addFinal($('typeInput').value);
  $('typeInput').value = '';
});

// ---------- list editing ----------
$('editBtn').addEventListener('click', () => {
  $('outline').value = outline;
  $('list').hidden = true;
  $('editor').hidden = false;
  $('outline').focus();
});

function closeEditor() { $('editor').hidden = true; $('list').hidden = false; }
$('cancelBtn').addEventListener('click', closeEditor);
$('saveBtn').addEventListener('click', () => {
  outline = $('outline').value;
  items = parseOutline(outline);
  const keys = new Set(flatten(items).map(i => i.key));
  done = new Set([...done].filter(k => keys.has(k)));
  opened = new Set([...opened].filter(k => keys.has(k)));
  save();
  closeEditor();
  render();
});

// Tab inserts indentation instead of leaving the textarea (Esc then Tab still leaves).
let escaped = false;
$('outline').addEventListener('keydown', e => {
  if (e.key === 'Escape') { escaped = true; return; }
  if (e.key === 'Tab' && !escaped) {
    e.preventDefault();
    const t = e.target;
    t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end');
  }
  escaped = false;
});

$('resetBtn').addEventListener('click', () => {
  if (!confirm('Uncheck everything and clear the transcript?')) return;
  done.clear();
  probs = {};
  finalText = '';
  opened.clear();
  sentUpTo = 0;
  interim = lastInterimSent = '';
  save();
  render();
  renderTranscript();
  status(recording ? 'listening' : 'idle');
});

// ---------- settings ----------
const dlg = $('settings');
function openSettings() {
  if (dlg.open) return;
  $('keyInput').value = settings.key;
  $('threshold').value = settings.threshold;
  $('thresholdOut').value = settings.threshold;
  $('langInput').value = settings.lang;
  dlg.showModal();
}
$('settingsBtn').addEventListener('click', openSettings);
$('threshold').addEventListener('input', e => { $('thresholdOut').value = e.target.value; });
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  settings = { key: $('keyInput').value.trim(), threshold: Number($('threshold').value), lang: $('langInput').value.trim() };
  store.set('settings', settings);
});

// ---------- boot ----------
fetch('/api/config').then(r => r.json()).then(c => {
  serverKey = c.serverKey;
  $('model').textContent = c.model;
  if (serverKey) $('keyHint').textContent = 'The server already has TYPESAFE_API_KEY set, so this can stay empty.';
  else if (!settings.key) openSettings();
}).catch(() => {});

if (!SR) $('speechWarn').hidden = false;
render();
renderTranscript();
