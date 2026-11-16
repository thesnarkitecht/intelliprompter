import { parseOutline, flatten, buildRequest, readAnswers, syncParents } from './core.js';

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
  Thank the sales team
Product roadmap
  Launch of the mobile app
  Pricing changes
Close and thank the audience`;

let outline = store.get('outline', SAMPLE);
let items = parseOutline(outline);
let done = new Set(store.get('done', []));
let probs = {};
let finalText = store.get('transcript', '');
let settings = { key: '', threshold: 70, lang: '', ...store.get('settings', {}) };
let serverKey = false;

// ---------- rendering ----------
function render(flashKeys = []) {
  syncParents(items, done);
  const list = $('list');
  list.replaceChildren();
  const leaves = flatten(items).filter(i => !i.children.length);
  const next = leaves.find(i => !done.has(i.key));

  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '> list is empty. Click "Edit list" to add items.';
    list.append(li);
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.append(row(item, next, flashKeys));
    if (item.children.length) {
      const ul = document.createElement('ul');
      for (const c of item.children) {
        const cli = document.createElement('li');
        cli.append(row(c, next, flashKeys));
        ul.append(cli);
      }
      li.append(ul);
    }
    list.append(li);
  }

  const count = leaves.filter(i => done.has(i.key)).length;
  $('progress').textContent = `${count}/${leaves.length} DONE`;
  $('meterFill').style.width = leaves.length ? `${(count / leaves.length) * 100}%` : '0';
  const parent = next && items.find(i => i.children.includes(next));
  $('headline').textContent = !leaves.length ? 'Add your list.'
    : next ? (parent ? `${parent.text}: ${next.text}` : next.text)
    : 'All done. Nice.';
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
    for (const i of [item, ...item.children]) box.checked ? done.add(i.key) : done.delete(i.key);
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
    prob.title = 'Jev’s confidence that this was covered';
  }
  label.append(box, text, prob);
  return label;
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
  store.set('transcript', finalText);
}

const status = text => { $('status').textContent = text; };

// ---------- Jev ----------
let inflight = false;
let pending = false;
let timer;

function scheduleCheck() {
  clearTimeout(timer);
  timer = setTimeout(runCheck, 900);
}

async function runCheck() {
  if (!finalText.trim()) return;
  if (inflight) { pending = true; return; }
  const { body, keys } = buildRequest(finalText, items, done);
  if (!Object.keys(keys).length) return;

  inflight = true;
  status('asking jev…');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.key) headers['X-TypeSafe-Key'] = settings.key;
    const res = await fetch('/api/check', { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || data.message || `HTTP ${res.status}`);

    const { probs: p, newlyDone } = readAnswers(data.answers, keys, settings.threshold / 100);
    Object.assign(probs, p);
    newlyDone.forEach(k => done.add(k));
    save();
    render(newlyDone);
    status(newlyDone.length ? `✓ ${newlyDone.length} checked` : 'listening');
  } catch (e) {
    status(`error: ${typeof e.message === 'string' ? e.message : 'request failed'}`.slice(0, 80));
    if (!settings.key && !serverKey) $('settings').showModal();
  } finally {
    inflight = false;
    if (pending) { pending = false; scheduleCheck(); }
  }
}

function addFinal(text) {
  text = text.trim();
  if (!text) return;
  finalText = finalText ? `${finalText} ${text}` : text;
  save();
  renderTranscript();
  scheduleCheck();
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
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) addFinal(r[0].transcript);
      else interim += r[0].transcript;
    }
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
  if (recording) { setRecording(false); rec.stop(); } else startRec();
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
  save();
  closeEditor();
  render();
  scheduleCheck();
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
  save();
  render();
  renderTranscript();
  status(recording ? 'listening' : 'idle');
});

// ---------- settings ----------
const dlg = $('settings');
$('settingsBtn').addEventListener('click', () => {
  $('keyInput').value = settings.key;
  $('threshold').value = settings.threshold;
  $('thresholdOut').value = settings.threshold;
  $('langInput').value = settings.lang;
  dlg.showModal();
});
$('threshold').addEventListener('input', e => { $('thresholdOut').value = e.target.value; });
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  settings = { key: $('keyInput').value.trim(), threshold: Number($('threshold').value), lang: $('langInput').value.trim() };
  store.set('settings', settings);
  scheduleCheck();
});

// ---------- boot ----------
fetch('/api/config').then(r => r.json()).then(c => {
  serverKey = c.serverKey;
  $('model').textContent = c.model;
  if (serverKey) $('keyHint').textContent = 'The server already has TYPESAFE_API_KEY set, so this can stay empty.';
}).catch(() => {});

if (!SR) $('speechWarn').hidden = false;
render();
renderTranscript();
