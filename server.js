import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const API_URL = process.env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-latest';
const PUBLIC = join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new Error('Request too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function check(req, res) {
  // Server key wins; otherwise accept the key the user pasted into Settings.
  const key = process.env.TYPESAFE_API_KEY || req.headers['x-typesafe-key'];
  if (!key) return send(res, 400, { error: 'No TypeSafe API key. Add one in Settings or set TYPESAFE_API_KEY.' });

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
  if (!body || typeof body.state !== 'object' || typeof body.questions !== 'object') {
    return send(res, 400, { error: 'Expected { state, questions }' });
  }
  if (!Object.keys(body.questions).length) return send(res, 200, { answers: {} });

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state: body.state, questions: body.questions }),
      signal: AbortSignal.timeout(20_000),
    });
    send(res, r.status, await r.text());
  } catch (e) {
    send(res, 502, { error: `Could not reach Jev: ${e.message}` });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/check') return check(req, res);
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return send(res, 200, { serverKey: Boolean(process.env.TYPESAFE_API_KEY), model: MODEL });
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const file = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, { error: 'Not found' });
  }
});

server.listen(PORT, () => console.log(`Intelliprompter → http://localhost:${server.address().port}  (model ${MODEL}${process.env.TYPESAFE_API_KEY ? ', server key set' : ', no server key'})`));
export default server;
