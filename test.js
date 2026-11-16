// Self-check: core logic + the /api/check proxy against a fake Jev. Run: npm test
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseOutline, flatten, buildRequest, readAnswers, syncParents, takeSample } from './public/core.js';

// --- core ---
const items = parseOutline('- Intro\nAgenda\n  * Results\n    Europe\n\t\tUS\n\t1. Roadmap\n\nClose\n');
assert.deepEqual(items.map(i => i.text), ['Intro', 'Agenda', 'Close']);
assert.deepEqual(items[1].children.map(c => c.key), ['Agenda › Results', 'Agenda › Roadmap']);
assert.deepEqual(items[1].children[0].children.map(c => c.key), ['Agenda › Results › Europe', 'Agenda › Results › US'], 'sub-sub-items nest');
assert.deepEqual(parseOutline('  orphan sub-item').map(i => i.text), ['orphan sub-item']);
assert.equal(flatten(items).length, 7);

// samples: only new text (plus overlap) is sent
assert.equal(takeSample('', 0), null);
assert.equal(takeSample('old words', 9), null, 'nothing new → no request');
assert.deepEqual(takeSample('old words', 9, 'still talking'), { text: 'old words still talking', sentUpTo: 9 });
const long = 'x'.repeat(1000) + ' new bit';
const s1 = takeSample(long, 1000);
assert.ok(s1.text.endsWith('new bit') && s1.text.length < 300, 'old text beyond the overlap is not resent');
assert.equal(s1.sentUpTo, long.length);

const done = new Set(['Intro']);
const { body, keys } = buildRequest('we covered the results', items, done);
assert.deepEqual(Object.values(keys), ['Agenda › Results › Europe', 'Agenda › Results › US', 'Agenda › Roadmap', 'Close'], 'only open leaves');
assert.equal(body.state.transcript, 'we covered the results');
for (const [id, q] of Object.entries(body.questions)) {
  assert.equal(q.type, 'noul');
  assert.ok(q.instructions.includes(`\`checklist.${id}\``));
  assert.ok(q.instructions.includes('started talking about'));
  assert.equal(body.state.checklist[id], keys[id]);
}

const ids = Object.keys(keys);
const { probs, newlyDone } = readAnswers(
  { [ids[0]]: { type: 'noul', noul: 0.91 }, [ids[1]]: { type: 'noul', noul: 0.2 } }, keys, 0.7);
assert.deepEqual(newlyDone, ['Agenda › Results › Europe']);
assert.equal(probs['Agenda › Results › US'], 0.2);
assert.ok(!('Close' in probs), 'missing answers are ignored');

newlyDone.forEach(k => done.add(k));
syncParents(items, done);
assert.ok(!done.has('Agenda › Results') && !done.has('Agenda'));
done.add('Agenda › Results › US');
syncParents(items, done);
assert.ok(done.has('Agenda › Results') && !done.has('Agenda'), 'middle level follows its children');
done.add('Agenda › Roadmap');
assert.ok(syncParents(items, done).has('Agenda'), 'top level follows the middle level');
done.delete('Agenda › Results › US');
syncParents(items, done);
assert.ok(!done.has('Agenda › Results') && !done.has('Agenda'), 'unchecking a leaf unchecks every ancestor');

// --- server proxy against a fake Jev ---
let seen;
const fake = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  seen = { auth: req.headers.authorization, body: JSON.parse(raw) };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ model: 'jev-test', answers: { q1: { type: 'noul', noul: 0.88 } } }));
}).listen(0);
await new Promise(r => fake.once('listening', r));

process.env.PORT = '0';
process.env.TYPESAFE_API_URL = `http://127.0.0.1:${fake.address().port}`;
delete process.env.TYPESAFE_API_KEY;
const { default: server } = await import('./server.js');
await new Promise(r => server.listening ? r() : server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const post = (headers, payload) => fetch(`${base}/api/check`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });

assert.equal((await post({}, body)).status, 400, 'no key → 400');
assert.equal((await post({ 'X-TypeSafe-Key': 'k' }, { nope: 1 })).status, 400, 'bad body → 400');

const r = await post({ 'X-TypeSafe-Key': 'test-key' }, body);
assert.equal(r.status, 200);
assert.equal((await r.json()).answers.q1.noul, 0.88);
assert.equal(seen.auth, 'Bearer test-key');
assert.equal(seen.body.model, 'jev-latest');
assert.deepEqual(seen.body.questions, body.questions);

assert.equal((await fetch(`${base}/`)).status, 200);
assert.equal((await fetch(`${base}/core.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
for (const p of ['/..%2fserver.js', '/%2e%2e/server.js']) {
  assert.notEqual((await fetch(base + p)).status, 200, `no path traversal via ${p}`);
}

server.close();
fake.close();
console.log('all checks passed');
