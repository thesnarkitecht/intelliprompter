// Pure logic shared by the browser app and the Node self-check (test.js).

export const CHECK_EVERY_MS = 5000;
const OVERLAP = 200; // chars of already-sent text repeated so a sentence split across checks still reads whole
const MAX_SAMPLE = 4000;

// One item per line; deeper indentation (spaces, tab = 2) nests under the line above, to any depth.
export function parseOutline(text) {
  const root = { key: '', children: [] };
  const stack = [{ indent: -1, node: root }];
  for (const raw of text.split('\n')) {
    const label = raw.trim().replace(/^([-*•]|\d+[.)]|\[[ xX]?\])\s*/, '').trim();
    if (!label) continue;
    const indent = raw.match(/^\s*/)[0].replace(/\t/g, '  ').length;
    while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).node;
    const node = { key: parent.key ? `${parent.key} › ${label}` : label, text: label, children: [] };
    parent.children.push(node);
    stack.push({ indent, node });
  }
  return root.children;
}

export function flatten(items) {
  return items.flatMap(i => [i, ...flatten(i.children)]);
}

// The text to send this check: only what's new since `sentUpTo` (plus a little overlap)
// and the phrase still being spoken. Returns null when there's nothing new.
export function takeSample(finalText, sentUpTo, interim = '') {
  if (!finalText.slice(sentUpTo).trim() && !interim.trim()) return null;
  const text = `${finalText.slice(Math.max(0, sentUpTo - OVERLAP))} ${interim}`.trim().slice(-MAX_SAMPLE);
  return { text, sentUpTo: finalText.length };
}

// One Jev "noul" (yes/no probability) question per open leaf, and per section not yet opened
// (so its sub-items can drop down as soon as you start on it).
export function buildRequest(sample, items, done, opened = new Set()) {
  const checklist = {};
  const questions = {};
  const keys = {};
  flatten(items).forEach((item, n) => {
    if (done.has(item.key) || opened.has(item.key)) return;
    const id = `q${n}`;
    checklist[id] = item.key;
    keys[id] = item.key;
    questions[id] = {
      type: 'noul',
      instructions: `Checklist item \`checklist.${id}\` ("›" separates a topic from its sub-topics). ` +
        `Has the speaker in \`transcript\` started talking about this item's topic? ` +
        `Mentioning it or beginning to discuss it counts; it does not need to be finished.`,
    };
  });
  return { body: { state: { transcript: sample, checklist }, questions }, keys };
}

// Returns { probs: {key: p}, newlyDone: [key] } for answers at or above threshold.
export function readAnswers(answers, keys, threshold) {
  const probs = {};
  const newlyDone = [];
  for (const [id, key] of Object.entries(keys)) {
    const p = answers?.[id]?.noul;
    if (typeof p !== 'number') continue;
    probs[key] = p;
    if (p >= threshold) newlyDone.push(key);
  }
  return { probs, newlyDone };
}

// A hit on a leaf checks it; a hit on a section opens it. Either way every section
// above it opens too, so jumping straight to a sub-sub-topic reveals the path to it.
// Returns the keys of sections that just opened.
export function applyHits(items, hitKeys, done, opened) {
  const hits = new Set(hitKeys);
  const before = new Set(opened);
  const walk = (list, ancestors) => {
    for (const item of list) {
      if (hits.has(item.key)) {
        item.children.length ? opened.add(item.key) : done.add(item.key);
        ancestors.forEach(a => opened.add(a.key));
      }
      walk(item.children, [...ancestors, item]);
    }
  };
  walk(items, []);
  return [...opened].filter(k => !before.has(k));
}

// Parents follow their sub-items at every level: all done → done, otherwise not done.
export function syncParents(items, done) {
  const sync = item => {
    if (!item.children.length) return done.has(item.key);
    const all = item.children.map(sync).every(Boolean); // map first so every branch syncs
    all ? done.add(item.key) : done.delete(item.key);
    return all;
  };
  items.forEach(sync);
  return done;
}

// Sections that are finished now but weren't in `before` (a copy of `done` taken earlier).
// The app folds these up once you finish them.
export function finishedSections(items, done, before) {
  syncParents(items, done);
  return flatten(items).filter(i => i.children.length && done.has(i.key) && !before.has(i.key)).map(i => i.key);
}
