import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { createDemoProvider } from '../server/demo.js';
import { SessionStore } from '../server/sessions.js';

let server;
let base;
let dir;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-parley-test-'));
  const store = new SessionStore(dir);
  await store.init();
  const app = createApp({ provider: createDemoProvider({ delayMs: 0, chunk: 40 }), store, log: false });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

function parseEvents(text) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const event = /^event: (.*)$/m.exec(chunk)[1];
      const data = JSON.parse(/^data: (.*)$/m.exec(chunk)[1]);
      return { event, data };
    });
}

async function post(url, body) {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
}

const participants = [
  { kind: 'preset', presetId: 'gandhi', model: 'claude-opus-5-5' },
  { kind: 'preset', presetId: 'einstein', model: 'claude-haiku-5-5' },
  { kind: 'model', model: 'claude-sonnet-5-5' },
];

test('serves the page, shared modules and fonts', async () => {
  for (const url of ['/', '/js/main.js', '/shared/figures.js', '/fonts/vt323/400.css', '/fonts/press-start-2p/400.css']) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200, url);
  }
});

test('lists models in demo mode', async () => {
  const res = await fetch(`${base}/api/models`);
  const body = await res.json();
  assert.equal(body.demo, true);
  assert.equal(body.defaultModel, 'claude-opus-5-5');
  assert.ok(body.models.some((m) => m.id === 'claude-haiku-5-5'));
});

test('streams a turn as server-sent events', async () => {
  const r = await post('/api/turn', {
    participants,
    speaker: 1,
    transcript: [{ speaker: 0, text: 'Friends, let us begin.' }],
    agenda: 'What is time?',
    settings: { length: 'short', effort: 'low', knowledge: 'era', order: 'natural' },
    turn: { number: 2, total: 6 },
  });
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/event-stream/);
  const events = parseEvents(r.text);
  assert.equal(events[0].event, 'start');
  assert.equal(events[0].data.model, 'claude-haiku-5-5');
  const done = events.find((e) => e.event === 'done').data;
  const streamed = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
  assert.ok(done.text.length > 10);
  assert.equal(streamed, done.text);
  assert.match(done.cue, /It's your turn, Albert Einstein/);
  assert.equal(done.refused, false);
});

test('rejects bad turn requests', async () => {
  const one = await post('/api/turn', { participants: participants.slice(0, 1), speaker: 0, turn: { number: 1, total: 1 } });
  assert.equal(one.status, 400);
  const badSpeaker = await post('/api/turn', { participants, speaker: 7, turn: { number: 1, total: 1 } });
  assert.equal(badSpeaker.status, 400);
  const badModel = await post('/api/turn', {
    participants: [{ kind: 'model', model: 'gpt-4' }, participants[0]],
    speaker: 0,
    turn: { number: 1, total: 1 },
  });
  assert.equal(badModel.status, 400);
  assert.match(JSON.parse(badModel.text).error, /not a valid Claude model/);
});

test('streams a recap', async () => {
  const r = await post('/api/recap', {
    participants,
    transcript: [
      { speaker: 0, text: 'Truth is God.' },
      { speaker: 1, text: 'Imagination matters more than knowledge.' },
    ],
    agenda: '',
    model: 'claude-opus-5-5',
  });
  const done = parseEvents(r.text).find((e) => e.event === 'done').data;
  assert.match(done.text, /## Headline/);
  assert.match(done.text, /Albert Einstein/);
});

test('saves, lists, loads and deletes sessions', async () => {
  const id = '2026-11-18_10-00-00-test';
  const session = {
    title: 'Test parley',
    agenda: 'Testing',
    settings: { order: 'round-robin', length: 'short', effort: 'low', knowledge: 'era', recapModel: 'claude-opus-5-5' },
    totalTurns: 4,
    participants,
    transcript: [{ speaker: 0, text: 'Hello.', model: 'claude-opus-5-5', turn: 1, usage: { input: 5, output: 2 } }, { speaker: -1, text: 'Note.' }],
    recap: null,
  };
  const put = await fetch(`${base}/api/sessions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session) });
  assert.equal(put.status, 200);
  const summary = await put.json();
  assert.equal(summary.turns, 1);

  const list = await (await fetch(`${base}/api/sessions`)).json();
  assert.ok(list.sessions.some((s) => s.id === id && s.title === 'Test parley'));

  const loaded = await (await fetch(`${base}/api/sessions/${id}`)).json();
  assert.equal(loaded.participants[1].name, 'Albert Einstein');
  assert.equal(loaded.transcript[0].usage.input, 5);
  assert.equal(loaded.settings.recapModel, 'claude-opus-5-5');

  assert.equal((await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/api/sessions/${id}`)).status, 404);
});

test('refuses unsafe session ids and invalid sessions', async () => {
  assert.equal((await fetch(`${base}/api/sessions/..%2F..%2Fetc%2Fpasswd`)).status, 400);
  const bad = await fetch(`${base}/api/sessions/ok-id`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participants: [{ kind: 'preset', presetId: 'nobody', model: 'claude-opus-5-5' }] }),
  });
  assert.equal(bad.status, 400);
});

test('lists every power source and routes a turn to the chosen one', async () => {
  const { createApp: make } = await import('../server/index.js');
  const calls = [];
  const fakeCc = {
    id: 'claude-code',
    demo: false,
    listModels: async () => [{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', price: null, efforts: ['low'] }],
    stream: async (args) => {
      calls.push(args.model);
      args.onText('From the subscription.');
      return { text: 'From the subscription.', stopReason: 'end_turn', refused: false, servedBy: args.model, fellBack: false, usage: {} };
    },
  };
  const store = new SessionStore(dir);
  const app = make({ providers: { demo: createDemoProvider({ delayMs: 0 }), 'claude-code': fakeCc }, defaultBackend: 'demo', store, log: false });
  const srv = app.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const info = await (await fetch(`${url}/api/models`)).json();
    assert.deepEqual(info.backends.map((b) => b.id), ['demo', 'claude-code']);
    assert.equal(info.defaultBackend, 'demo');
    assert.equal(info.modelsByBackend['claude-code'][0].price, null);
    const res = await fetch(`${url}/api/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participants, speaker: 0, transcript: [], settings: { backend: 'claude-code' }, turn: { number: 1, total: 2 } }),
    });
    const done = parseEvents(await res.text()).find((e) => e.event === 'done').data;
    assert.equal(done.text, 'From the subscription.');
    assert.deepEqual(calls, ['claude-opus-5-5']);
  } finally {
    srv.close();
  }
});
