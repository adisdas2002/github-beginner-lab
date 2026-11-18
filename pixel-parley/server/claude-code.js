// "Claude Code (my subscription)": each turn is written by the Claude Code CLI
// (`claude -p`) installed on this computer, so usage comes out of whatever
// account Claude Code is logged in with, such as a Pro or Max subscription,
// instead of an API key.
//
// For personal use on your own machine: don't use this to offer your
// subscription to other people.
//
// Every call runs with tools, MCP servers, slash commands and session saving
// turned off, in an empty temporary folder, with our own system prompt.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODEL_CATALOG } from '../shared/models.js';

const EFFORTS = ['low', 'medium', 'high'];

// Keys for the API must not leak into Claude Code, or it would bill the API
// instead of the subscription.
const STRIPPED_ENV = ['ANTHROPIC_API_KEY', 'PIXEL_PARLEY_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

export function childEnv(env = process.env) {
  const out = { ...env };
  for (const key of STRIPPED_ENV) delete out[key];
  return out;
}

export function buildArgs({ model, system, effort }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', model,
    '--system-prompt', system,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--disable-slash-commands',
  ];
  if (effort && EFFORTS.includes(effort)) args.push('--effort', effort);
  return args;
}

// The CLI takes one prompt, so the per-agent message history is written out as
// a single transcript. The agent's own earlier lines are labeled "(you)".
export function flattenMessages(messages, selfName) {
  const parts = [];
  if (selfName && messages.some((m) => m.role === 'assistant')) {
    parts.push(`[Lines labeled "${selfName} (you)" are what you said earlier.]`);
  }
  for (const m of messages) {
    const text = typeof m.content === 'string' ? m.content : (m.content || []).map((b) => b.text || '').join('');
    parts.push(m.role === 'assistant' ? `${selfName || 'You'} (you): ${text}` : text);
  }
  return parts.join('\n\n');
}

// Parses the CLI's newline-delimited JSON. Calls onText for each text chunk and
// returns the final summary.
export function createStreamParser(onText) {
  let buffer = '';
  const state = { text: '', model: null, stopReason: null, usage: null, error: null, gotDeltas: false, finalText: null };

  const handle = (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === 'system' && msg.subtype === 'init' && msg.model) state.model = msg.model;
    if (msg.type === 'stream_event' && msg.event) {
      const ev = msg.event;
      if (ev.type === 'message_start' && ev.message && ev.message.model) state.model = ev.message.model;
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        state.gotDeltas = true;
        state.text += ev.delta.text;
        if (onText) onText(ev.delta.text);
      }
      if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) state.stopReason = ev.delta.stop_reason;
    }
    if (msg.type === 'assistant' && msg.message && !state.gotDeltas) {
      const t = (msg.message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (t) {
        state.text += t;
        if (onText) onText(t);
      }
    }
    if (msg.type === 'result') {
      if (msg.is_error || (msg.subtype && msg.subtype !== 'success')) {
        state.error = (typeof msg.result === 'string' && msg.result) || msg.subtype || 'Claude Code reported an error.';
      }
      if (typeof msg.result === 'string') state.finalText = msg.result;
      if (msg.stop_reason) state.stopReason = msg.stop_reason;
      if (msg.usage) state.usage = msg.usage;
    }
  };

  return {
    push(chunk) {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) handle(line);
      }
    },
    end() {
      if (buffer.trim()) handle(buffer.trim());
      buffer = '';
      return state;
    },
  };
}

export class ClaudeCodeError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function detectClaudeCode(command = 'claude', timeoutMs = 8000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, ['--version'], { env: childEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() || 'unknown version' : null);
    });
  });
}

export function createClaudeCodeProvider({ command = 'claude', spawnFn = spawn, workDir } = {}) {
  const cwd = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-parley-cc-'));

  return {
    id: 'claude-code',
    demo: false,
    async listModels() {
      // Plans don't expose a model list, so offer the current catalog; prices
      // don't apply because usage comes from the subscription.
      return MODEL_CATALOG.map((m) => ({ ...m, price: null, efforts: EFFORTS, createdAt: null }));
    },
    stream({ model, system, messages, effort, signal, onText, meta }) {
      const selfName = meta && meta.participants && Number.isInteger(meta.speaker) ? meta.participants[meta.speaker].name : null;
      const prompt = flattenMessages(messages, selfName);
      return new Promise((resolve, reject) => {
        let child;
        try {
          child = spawnFn(command, buildArgs({ model, system, effort }), { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (err) {
          reject(new ClaudeCodeError(`Could not start Claude Code: ${err.message}`));
          return;
        }
        const parser = createStreamParser(onText);
        let stderr = '';
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          if (signal) signal.removeEventListener('abort', onAbort);
          fn(value);
        };
        const onAbort = () => {
          child.kill();
          const err = new Error('Request was aborted.');
          err.name = 'AbortError';
          finish(reject, err);
        };
        if (signal) {
          if (signal.aborted) return onAbort();
          signal.addEventListener('abort', onAbort, { once: true });
        }
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (d) => parser.push(d));
        child.stderr.on('data', (d) => (stderr += d).length > 4000 && (stderr = stderr.slice(-4000)));
        child.on('error', (err) => {
          const msg =
            err.code === 'ENOENT'
              ? 'Claude Code is not installed (the "claude" command was not found). Install it and sign in, or pick another power source in Setup.'
              : `Could not start Claude Code: ${err.message}`;
          finish(reject, new ClaudeCodeError(msg, 503));
        });
        child.on('close', (code) => {
          const state = parser.end();
          if (state.error || (code !== 0 && !state.text)) {
            const detail = state.error || stderr.trim().split('\n').pop() || `exit code ${code}`;
            const hint = /log ?in|auth|credential|401/i.test(detail) ? ' Run "claude" in a terminal and sign in with your Claude account.' : '';
            finish(reject, new ClaudeCodeError(`Claude Code: ${detail}.${hint}`));
            return;
          }
          const usage = state.usage || {};
          finish(resolve, {
            text: state.text || state.finalText || '',
            stopReason: state.stopReason || 'end_turn',
            refused: state.stopReason === 'refusal',
            refusalCategory: null,
            servedBy: state.model || model,
            fellBack: false,
            usage: {
              input: usage.input_tokens || 0,
              output: usage.output_tokens || 0,
              cacheRead: usage.cache_read_input_tokens || 0,
              cacheWrite: usage.cache_creation_input_tokens || 0,
            },
          });
        });
        child.stdin.on('error', () => {});
        child.stdin.end(prompt);
      });
    },
  };
}
