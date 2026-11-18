// Pixel Parley server: serves the game and talks to Claude.
//
//   npm start          live mode if PIXEL_PARLEY_API_KEY or ANTHROPIC_API_KEY is set
//   npm run subscription  use Claude Code (and the subscription it's logged in with)
//   npm run demo       demo mode (canned lines, no API calls)

import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createClaudeProvider, describeError } from './llm.js';
import { createDemoProvider } from './demo.js';
import { createClaudeCodeProvider, detectClaudeCode } from './claude-code.js';
import { SessionStore, isValidSessionId } from './sessions.js';
import { parseTurnRequest, parseRecapRequest, sanitizeSession, ValidationError } from './validate.js';
import {
  buildSystemPrompt,
  buildTurnMessages,
  makeCue,
  cleanReply,
  trimToSentence,
  createReplyStreamer,
  buildRecapRequest,
} from './prompts.js';
import { DEFAULT_MODEL, MODEL_CATALOG } from '../shared/models.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export const TURN_MAX_TOKENS = 4096;
export const RECAP_MAX_TOKENS = 16000;

function openEventStream(res) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  return (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

function logUsage(label, model, result) {
  const u = result.usage || {};
  const served = result.fellBack ? ` (served by ${result.servedBy})` : '';
  console.log(
    `[${label}] ${model}${served}: ${u.input} in + ${u.cacheRead} cached + ${u.cacheWrite} cache-write, ${u.output} out` +
      (result.refused ? `, declined (${result.refusalCategory || 'no category'})` : ''),
  );
}

export const BACKEND_LABELS = {
  api: 'Claude API (API key)',
  'claude-code': 'Claude Code (my subscription)',
  demo: 'Demo (canned lines, no AI)',
};

export function createApp({ provider, providers, defaultBackend, store, log = true }) {
  const backends = providers || { [provider.id || (provider.demo ? 'demo' : 'api')]: provider };
  const fallbackId = defaultBackend && backends[defaultBackend] ? defaultBackend : Object.keys(backends)[0];
  const pickId = (id) => (id && backends[id] ? id : fallbackId);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.use(express.static(path.join(root, 'public')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/fonts/press-start-2p', express.static(path.join(root, 'node_modules/@fontsource/press-start-2p')));
  app.use('/fonts/vt323', express.static(path.join(root, 'node_modules/@fontsource/vt323')));

  app.get('/api/config', (req, res) => {
    res.json({ demo: backends[fallbackId].demo, defaultModel: DEFAULT_MODEL, defaultBackend: fallbackId });
  });

  app.get('/api/models', async (req, res) => {
    const modelsByBackend = {};
    const warnings = {};
    for (const [id, p] of Object.entries(backends)) {
      try {
        modelsByBackend[id] = await p.listModels();
      } catch (err) {
        const info = describeError(err);
        console.warn(`[models] ${id}: could not list models (${info.status}): ${info.message}`);
        modelsByBackend[id] = MODEL_CATALOG;
        warnings[id] = info.message;
      }
    }
    res.json({
      demo: backends[fallbackId].demo,
      defaultModel: DEFAULT_MODEL,
      defaultBackend: fallbackId,
      backends: Object.keys(backends).map((id) => ({ id, label: BACKEND_LABELS[id] || id })),
      modelsByBackend,
      models: modelsByBackend[fallbackId],
      warning: warnings[fallbackId],
    });
  });

  app.post('/api/turn', async (req, res) => {
    let input;
    try {
      input = parseTurnRequest(req.body);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    const { participants, speaker, transcript, agenda, settings, turn } = input;
    const me = participants[speaker];
    const provider = backends[pickId(settings.backend)];
    const cue = makeCue({ participants, transcript, speaker, agenda, turnNumber: turn.number, totalTurns: turn.total });
    const system = buildSystemPrompt({
      participants,
      speaker,
      agenda,
      length: settings.length,
      knowledge: settings.knowledge,
    });
    const messages = buildTurnMessages({ participants, transcript, speaker, cue });

    const send = openEventStream(res);
    const controller = new AbortController();
    let finished = false;
    res.on('close', () => {
      if (!finished) controller.abort();
    });

    send('start', { speaker, model: me.model, cue });
    const streamer = createReplyStreamer(participants, speaker, (text) => send('delta', { text }));
    try {
      const result = await provider.stream({
        kind: 'turn',
        model: me.model,
        system,
        messages,
        maxTokens: TURN_MAX_TOKENS,
        effort: settings.effort,
        signal: controller.signal,
        onText: streamer.push,
        meta: { participants, transcript, speaker, agenda, turnNumber: turn.number, totalTurns: turn.total },
      });
      streamer.flush();
      if (log) logUsage(`turn ${turn.number}/${turn.total} ${me.name}`, me.model, result);

      let text = '';
      if (!result.refused) {
        text = cleanReply(result.text, participants, speaker);
        if (result.stopReason === 'max_tokens') text = trimToSentence(text);
      }
      send('done', {
        text,
        refused: result.refused || !text,
        refusalCategory: result.refusalCategory,
        stopReason: result.stopReason,
        servedBy: result.servedBy,
        fellBack: result.fellBack,
        cue,
        usage: result.usage,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const info = describeError(err, me.model);
      console.error(`[turn] ${me.name} (${me.model}) failed: ${info.status} ${info.message}`);
      send('error', info);
    } finally {
      finished = true;
      res.end();
    }
  });

  app.post('/api/recap', async (req, res) => {
    let input;
    try {
      input = parseRecapRequest(req.body);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    const { participants, transcript, agenda, model } = input;
    const provider = backends[pickId(input.backend)];
    const { system, messages } = buildRecapRequest({ participants, transcript, agenda });

    const send = openEventStream(res);
    const controller = new AbortController();
    let finished = false;
    res.on('close', () => {
      if (!finished) controller.abort();
    });

    send('start', { model });
    try {
      const result = await provider.stream({
        kind: 'recap',
        model,
        system,
        messages,
        maxTokens: RECAP_MAX_TOKENS,
        effort: 'medium',
        signal: controller.signal,
        onText: (text) => send('delta', { text }),
        meta: { participants, transcript, agenda },
      });
      if (log) logUsage('recap', model, result);
      send('done', {
        text: result.refused ? '' : result.text.trim(),
        refused: result.refused,
        servedBy: result.servedBy,
        fellBack: result.fellBack,
        usage: result.usage,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const info = describeError(err, model);
      console.error(`[recap] ${model} failed: ${info.status} ${info.message}`);
      send('error', info);
    } finally {
      finished = true;
      res.end();
    }
  });

  app.get('/api/sessions', async (req, res) => {
    res.json({ sessions: await store.list() });
  });

  app.get('/api/sessions/:id', async (req, res) => {
    if (!isValidSessionId(req.params.id)) return res.status(400).json({ error: 'Invalid session id.' });
    const session = await store.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    res.json(session);
  });

  app.put('/api/sessions/:id', async (req, res) => {
    if (!isValidSessionId(req.params.id)) return res.status(400).json({ error: 'Invalid session id.' });
    let session;
    try {
      session = sanitizeSession(req.body);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    res.json(await store.save(req.params.id, session));
  });

  app.delete('/api/sessions/:id', async (req, res) => {
    if (!isValidSessionId(req.params.id)) return res.status(400).json({ error: 'Invalid session id.' });
    const removed = await store.remove(req.params.id);
    res.status(removed ? 200 : 404).json({ removed });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    console.error(err);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'Server error.' });
  });

  return app;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read .env: ${err.message}`);
  }

  // PIXEL_PARLEY_API_KEY wins so a key meant for this app never collides with
  // tools that also read ANTHROPIC_API_KEY.
  const apiKey = process.env.PIXEL_PARLEY_API_KEY || process.env.ANTHROPIC_API_KEY;
  const forcedDemo = argv.includes('--demo') || process.env.DEMO_MODE === '1';
  const providers = { demo: createDemoProvider() };
  let defaultBackend = 'demo';
  let claudeCodeVersion = null;
  if (!forcedDemo) {
    if (apiKey) providers.api = createClaudeProvider({ apiKey });
    const command = process.env.PIXEL_PARLEY_CLAUDE_COMMAND || 'claude';
    if (process.env.PIXEL_PARLEY_CLAUDE_CODE !== '0') claudeCodeVersion = await detectClaudeCode(command);
    if (claudeCodeVersion) providers['claude-code'] = createClaudeCodeProvider({ command });
    const wanted = argv.includes('--subscription') ? 'claude-code' : process.env.PIXEL_PARLEY_BACKEND;
    if (wanted && !providers[wanted]) {
      console.warn(`Power source "${wanted}" is not available; ${wanted === 'claude-code' ? 'the "claude" command was not found.' : 'check your settings.'}`);
    }
    defaultBackend = providers[wanted] ? wanted : providers.api ? 'api' : providers['claude-code'] ? 'claude-code' : 'demo';
  }

  const store = new SessionStore(process.env.PIXEL_PARLEY_LOG_DIR || path.join(root, 'logs'));
  await store.init();

  const app = createApp({ providers, defaultBackend, store });
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`Pixel Parley is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    for (const id of Object.keys(providers)) {
      const extra = id === 'claude-code' ? ` (claude ${claudeCodeVersion})` : '';
      console.log(`${id === defaultBackend ? '* ' : '  '}${BACKEND_LABELS[id]}${extra}`);
    }
    if (forcedDemo) console.log('DEMO MODE: canned lines, no API calls.');
    else if (defaultBackend === 'demo') {
      console.log('No API key or Claude Code found, so starting in demo mode. Set PIXEL_PARLEY_API_KEY, or install Claude Code and sign in.');
    }
    console.log('Choose the power source in the Setup panel.');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
