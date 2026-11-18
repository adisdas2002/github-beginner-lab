import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildRequest,
  fromModelInfo,
  summarizeMessage,
  describeError,
  createClaudeProvider,
  FALLBACK_BETA,
} from '../server/llm.js';

const base = { system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 4096 };

test('effort is sent only when the model supports that level', () => {
  const yes = buildRequest({ ...base, model: 'claude-haiku-5-5', effort: 'low', efforts: ['low', 'medium', 'high'] });
  assert.deepEqual(yes.params.output_config, { effort: 'low' });
  const no = buildRequest({ ...base, model: 'claude-haiku-4-5', effort: 'low', efforts: [] });
  assert.equal(no.params.output_config, undefined);
});

test('requests use automatic prompt caching and never send sampling params', () => {
  const r = buildRequest({ ...base, model: 'claude-haiku-5-5', effort: 'low', efforts: ['low'] });
  assert.deepEqual(r.params.cache_control, { type: 'ephemeral' });
  assert.equal(r.params.temperature, undefined);
  assert.equal(r.params.max_tokens, 4096);
});

test('fallback-capable models opt into server-side refusal fallbacks', () => {
  const r = buildRequest({ ...base, model: 'claude-opus-5-5', effort: 'low', efforts: ['low'] });
  assert.equal(r.beta, true);
  assert.deepEqual(r.params.betas, [FALLBACK_BETA]);
  assert.equal(r.params.fallbacks, 'default');
  const plain = buildRequest({ ...base, model: 'claude-haiku-5-5', efforts: [] });
  assert.equal(plain.beta, false);
  assert.equal(plain.params.fallbacks, undefined);
});

test('model info reads effort capabilities from the Models API', () => {
  const m = fromModelInfo({
    id: 'claude-sonnet-5-5',
    display_name: 'Claude Sonnet 5.5',
    created_at: '2026-09-01T00:00:00Z',
    capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: false } } },
  });
  assert.equal(m.name, 'Claude Sonnet 5.5');
  assert.deepEqual(m.efforts, ['low', 'medium']);
  assert.deepEqual(m.price, [2, 10]);
  const none = fromModelInfo({ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', capabilities: { effort: { supported: false } } });
  assert.deepEqual(none.efforts, []);
  const unknown = fromModelInfo({ id: 'claude-future-9', display_name: null, capabilities: null });
  assert.equal(unknown.name, 'Claude Future 9');
  assert.deepEqual(unknown.efforts, []);
});

test('summarizeMessage reports text, fallbacks and refusals', () => {
  const served = summarizeMessage(
    {
      model: 'claude-opus-4-8',
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Hello ' }, { type: 'fallback', from: {}, to: {} }, { type: 'text', text: 'there.' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, iterations: [{ type: 'message' }, { type: 'fallback_message' }] },
    },
    'claude-opus-5-5',
  );
  assert.equal(served.text, 'Hello there.');
  assert.equal(served.fellBack, true);
  assert.equal(served.servedBy, 'claude-opus-4-8');
  assert.deepEqual(served.usage, { input: 10, output: 5, cacheRead: 3, cacheWrite: 0 });

  const refused = summarizeMessage({ stop_reason: 'refusal', stop_details: { category: 'general_harms' }, content: [] }, 'claude-sonnet-5-5');
  assert.equal(refused.refused, true);
  assert.equal(refused.refusalCategory, 'general_harms');
});

test('SDK errors become friendly messages with status codes', () => {
  const headers = new Headers();
  const err = (status) => Anthropic.APIError.generate(status, { error: { message: 'x' } }, 'x', headers);
  assert.equal(describeError(err(401), 'm').status, 401);
  assert.match(describeError(err(401), 'm').message, /API key/);
  assert.match(describeError(err(404), 'claude-x').message, /claude-x/);
  assert.match(describeError(err(429), 'm').message, /Rate limited/);
  assert.match(describeError(err(529), 'm').message, /overloaded/);
  assert.equal(describeError(new Error('boom'), 'm').message, 'boom');
});

function fakeClient({ message, models }) {
  const calls = [];
  const stream = (kind) => (params, options) => {
    calls.push({ kind, params, options });
    return {
      on(event, fn) {
        if (event === 'text') ['Hel', 'lo.'].forEach((d) => fn(d));
        return this;
      },
      finalMessage: async () => message,
    };
  };
  return {
    calls,
    models: {
      list: () =>
        (async function* () {
          yield* models;
        })(),
    },
    messages: { stream: stream('plain') },
    beta: { messages: { stream: stream('beta') } },
  };
}

test('provider streams text and shapes requests per model', async () => {
  const client = fakeClient({
    message: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello.' }], usage: { input_tokens: 1, output_tokens: 2 } },
    models: [
      { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true } } } },
      { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', capabilities: { effort: { supported: false } } },
    ],
  });
  const provider = createClaudeProvider({ client });
  const models = await provider.listModels();
  assert.deepEqual(models.map((m) => m.id), ['claude-opus-5-5', 'claude-haiku-4-5']);

  const chunks = [];
  const signal = new AbortController().signal;
  const out = await provider.stream({ ...base, model: 'claude-opus-5-5', effort: 'low', signal, onText: (t) => chunks.push(t) });
  assert.equal(out.text, 'Hello.');
  assert.deepEqual(chunks, ['Hel', 'lo.']);
  assert.equal(client.calls[0].kind, 'beta');
  assert.equal(client.calls[0].params.fallbacks, 'default');
  assert.deepEqual(client.calls[0].params.output_config, { effort: 'low' });
  assert.equal(client.calls[0].options.signal, signal);

  await provider.stream({ ...base, model: 'claude-haiku-4-5', effort: 'low', signal });
  assert.equal(client.calls[1].kind, 'plain');
  assert.equal(client.calls[1].params.output_config, undefined);
});
