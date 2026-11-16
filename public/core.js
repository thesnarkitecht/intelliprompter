// Pure logic shared by the browser app and the Node self-check (test.js).

// "Item" lines at column 0; indented lines are sub-items of the item above.
export function parseOutline(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const indented = /^\s/.test(raw);
    const label = raw.trim().replace(/^([-*•]|\d+[.)]|\[[ xX]?\])\s*/, '').trim();
    if (!label) continue;
    if (indented && items.length) {
      const parent = items[items.length - 1];
      parent.children.push({ key: `${parent.key} › ${label}`, text: label, children: [] });
    } else {
      items.push({ key: label, text: label, children: [] });
    }
  }
  return items;
}

export function flatten(items) {
  return items.flatMap(i => [i, ...i.children]);
}

// One Jev "noul" (yes/no probability) question per unchecked item.
export function buildRequest(transcript, items, done) {
  const checklist = {};
  const questions = {};
  const keys = {};
  flatten(items).forEach((item, n) => {
    if (done.has(item.key)) return;
    // A parent with sub-items is checked when all its sub-items are, so don't ask Jev about it.
    if (item.children.length) return;
    const id = `q${n}`;
    checklist[id] = item.key;
    keys[id] = item.key;
    questions[id] = {
      type: 'noul',
      instructions: `Checklist item \`checklist.${id}\` (a "›" means a sub-item of the part before it). ` +
        `Has the speaker in \`transcript\` clearly covered, said, or completed this item?`,
    };
  });
  return { body: { state: { transcript, checklist }, questions }, keys };
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

// Parents follow their sub-items: all done → done, otherwise not done.
export function syncParents(items, done) {
  for (const item of items) {
    if (!item.children.length) continue;
    if (item.children.every(c => done.has(c.key))) done.add(item.key);
    else done.delete(item.key);
  }
  return done;
}
