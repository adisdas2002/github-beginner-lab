// Pixel Parley server: serves the game and talks to Claude.
//
//   npm start          live mode if PIXEL_PARLEY_API_KEY or ANTHROPIC_API_KEY is set
//   npm run demo       demo mode (canned lines, no API calls)

import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createClaudeProvider, describeError } from './llm.js';
import { createDemoProvider } from './demo.js';
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

export function createApp({ provider, store, log = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.use(express.static(path.join(root, 'public')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use('/fonts/press-start-2p', express.static(path.join(root, 'node_modules/@fontsource/press-start-2p')));
  app.use('/fonts/vt323', express.static(path.join(root, 'node_modules/@fontsource/vt323')));

  app.get('/api/config', (req, res) => {
    res.json({ demo: provider.demo, defaultModel: DEFAULT_MODEL });
  });

  app.get('/api/models', async (req, res) => {
    try {
      const models = await provider.listModels();
      res.json({ demo: provider.demo, defaultModel: DEFAULT_MODEL, models, source: provider.demo ? 'catalog' : 'api' });
    } catch (err) {
      const info = describeError(err);
      console.warn(`[models] could not list models (${info.status}): ${info.message}`);
      res.json({
        demo: provider.demo,
        defaultModel: DEFAULT_MODEL,
        models: MODEL_CATALOG,
        source: 'catalog',
        warning: info.message,
      });
    }
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
  const demo = forcedDemo || !apiKey;
  const provider = demo ? createDemoProvider() : createClaudeProvider({ apiKey });

  const store = new SessionStore(process.env.PIXEL_PARLEY_LOG_DIR || path.join(root, 'logs'));
  await store.init();

  const app = createApp({ provider, store });
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`Pixel Parley is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (demo) {
      console.log(
        forcedDemo
          ? 'DEMO MODE: canned lines, no API calls.'
          : 'DEMO MODE: no API key found. Set PIXEL_PARLEY_API_KEY or ANTHROPIC_API_KEY (for example in .env) to use Claude.',
      );
    } else {
      console.log('Live mode: agents are powered by the Claude API.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
