import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createClaudeCodeProvider,
  detectClaudeCode,
  buildArgs,
  childEnv,
  flattenMessages,
  createStreamParser,
} from '../server/claude-code.js';

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.js');
const fakeSpawn = (extraEnv = {}) => (cmd, args, opts) =>
  spawn(process.execPath, [fake, ...args], { ...opts, env: { ...opts.env, FAKE_CLAUDE: '1', ...extraEnv } });

test('CLI arguments turn off tools, MCP, slash commands and session saving', () => {
  const args = buildArgs({ model: 'claude-haiku-5-5', system: 'SYS', effort: 'low' });
  assert.deepEqual(args.slice(0, 2), ['-p', '--output-format']);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  for (const flag of ['--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '--include-partial-messages']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.equal(args[args.indexOf('--system-prompt') + 1], 'SYS');
  assert.equal(args[args.indexOf('--effort') + 1], 'low');
  assert.ok(!args.includes('--bare'), '--bare would skip the stored subscription login');
  assert.ok(!buildArgs({ model: 'm', system: 's', effort: 'xhigh' }).includes('--effort'));
});

test('API keys never reach Claude Code, so it bills the subscription', () => {
  const env = childEnv({ ANTHROPIC_API_KEY: 'a', PIXEL_PARLEY_API_KEY: 'b', ANTHROPIC_AUTH_TOKEN: 'c', HOME: '/h' });
  assert.deepEqual(env, { HOME: '/h' });
});

test('message history is flattened into one transcript', () => {
  const text = flattenMessages(
    [
      { role: 'user', content: 'Caesar: Hail.\n\n(Your turn.)' },
      { role: 'assistant', content: 'Peace, friend.' },
      { role: 'user', content: '(Your turn again.)' },
    ],
    'Mahatma Gandhi',
  );
  assert.match(text, /Lines labeled "Mahatma Gandhi \(you\)"/);
  assert.match(text, /Mahatma Gandhi \(you\): Peace, friend\./);
  assert.match(text, /\(Your turn again\.\)$/);
});

test('the stream parser reads text deltas and the final result', () => {
  const seen = [];
  const p = createStreamParser((t) => seen.push(t));
  p.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}\n{"type":"stream_ev');
  p.push('ent","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}}\n');
  p.push('{"type":"result","subtype":"success","is_error":false,"result":"Hello","usage":{"input_tokens":1}}');
  const state = p.end();
  assert.deepEqual(seen, ['Hel', 'lo']);
  assert.equal(state.text, 'Hello');
  assert.equal(state.error, null);
});

test('provider streams a turn through the CLI', async () => {
  const provider = createClaudeCodeProvider({ spawnFn: fakeSpawn() });
  const chunks = [];
  const out = await provider.stream({
    model: 'claude-sonnet-5-5',
    system: 'You are Gandhi.',
    messages: [{ role: 'user', content: 'Hello there' }],
    effort: 'medium',
    onText: (t) => chunks.push(t),
  });
  assert.match(out.text, /^Heard \d+ chars; tools=""; effort=medium\.$/);
  assert.equal(chunks.join(''), out.text);
  assert.equal(out.servedBy, 'claude-sonnet-5-5');
  assert.equal(out.usage.input, 12);
  assert.ok((await provider.listModels()).every((m) => m.price === null));
});

test('a login problem becomes a clear error', async () => {
  const provider = createClaudeCodeProvider({ spawnFn: fakeSpawn({ FAKE_CLAUDE_MODE: 'auth-error' }) });
  await assert.rejects(
    provider.stream({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }] }),
    /Not logged in.*sign in with your Claude account/,
  );
});

test('a missing claude command is detected and explained', async () => {
  assert.equal(await detectClaudeCode('pixel-parley-no-such-command'), null);
  const provider = createClaudeCodeProvider({ command: 'pixel-parley-no-such-command' });
  await assert.rejects(provider.stream({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }] }), (err) => {
    assert.equal(err.status, 503);
    assert.match(err.message, /not installed/);
    return true;
  });
});

test('aborting stops the CLI', async () => {
  const provider = createClaudeCodeProvider({ spawnFn: fakeSpawn() });
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(provider.stream({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], signal: ac.signal }), {
    name: 'AbortError',
  });
});
