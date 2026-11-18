// Talking to Claude through the official Anthropic SDK.
//
// Every turn is streamed so the dialog box can type out text as it arrives.
// Per-model details handled here:
//  - `effort` is only sent to models that support it (from the Models API's
//    capabilities, falling back to the static catalog).
//  - For models with server-side refusal fallbacks, requests opt in with
//    `fallbacks: "default"`: if a safety classifier declines, the API retries on
//    Anthropic's recommended fallback model inside the same call. The response
//    reports which model actually served it, and the UI shows that.
//  - No sampling parameters (temperature etc.) and no assistant prefill: current
//    models reject both.
//  - Top-level `cache_control` turns on automatic prompt caching, so a long
//    conversation re-reads its growing history from cache.

import Anthropic from '@anthropic-ai/sdk';
import { MODEL_CATALOG, catalogEntry, modelFamily, prettyModelName } from '../shared/models.js';

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export const FALLBACK_MODELS = new Set([
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-mythos-5-2',
  'claude-mythos-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

const EFFORT_LEVELS = ['low', 'medium', 'high'];
const MODEL_CACHE_MS = 10 * 60 * 1000;

export function fromModelInfo(info) {
  const known = catalogEntry(info.id);
  const effortCaps = info.capabilities && info.capabilities.effort;
  const efforts = effortCaps
    ? effortCaps.supported
      ? EFFORT_LEVELS.filter((level) => effortCaps[level] && effortCaps[level].supported)
      : []
    : known
      ? known.efforts
      : [];
  return {
    id: info.id,
    name: info.display_name || (known && known.name) || prettyModelName(info.id),
    family: modelFamily(info.id),
    price: known ? known.price : null,
    efforts,
    createdAt: info.created_at || null,
  };
}

export function sortModels(models) {
  const order = new Map(MODEL_CATALOG.map((m, i) => [m.id, i]));
  const rank = (m) => (order.has(m.id) ? order.get(m.id) : Number.MAX_SAFE_INTEGER);
  return models.sort((a, b) => rank(a) - rank(b) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function buildRequest({ model, system, messages, maxTokens, effort, efforts }) {
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    cache_control: { type: 'ephemeral' },
  };
  if (effort && efforts.includes(effort)) params.output_config = { effort };
  if (FALLBACK_MODELS.has(model)) {
    return { beta: true, params: { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } };
  }
  return { beta: false, params };
}

export function summarizeMessage(msg, requestedModel) {
  const content = msg.content || [];
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const iterations = (msg.usage && msg.usage.iterations) || [];
  const fellBack =
    iterations.some((it) => it.type === 'fallback_message') || content.some((b) => b.type === 'fallback');
  const usage = msg.usage || {};
  return {
    text,
    stopReason: msg.stop_reason,
    refused: msg.stop_reason === 'refusal',
    refusalCategory: (msg.stop_details && msg.stop_details.category) || null,
    servedBy: msg.model || requestedModel,
    fellBack,
    usage: {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
    },
  };
}

export function createClaudeProvider({ apiKey, client: injectedClient } = {}) {
  const client = injectedClient || new Anthropic({ apiKey });
  let cache = null;

  async function listModels() {
    if (cache && Date.now() - cache.at < MODEL_CACHE_MS) return cache.models;
    const models = [];
    for await (const info of client.models.list({ limit: 100 })) models.push(fromModelInfo(info));
    sortModels(models);
    cache = { at: Date.now(), models };
    return models;
  }

  async function effortsFor(model) {
    let models = cache && cache.models;
    if (!models) {
      try {
        models = await listModels();
      } catch {
        models = null;
      }
    }
    const hit = models && models.find((m) => m.id === model);
    if (hit) return hit.efforts;
    const known = catalogEntry(model);
    return known ? known.efforts : [];
  }

  async function stream({ model, system, messages, maxTokens, effort, signal, onText }) {
    const efforts = effort ? await effortsFor(model) : [];
    const req = buildRequest({ model, system, messages, maxTokens, effort, efforts });
    const s = req.beta
      ? client.beta.messages.stream(req.params, { signal })
      : client.messages.stream(req.params, { signal });
    if (onText) s.on('text', (delta) => onText(delta));
    const msg = await s.finalMessage();
    return summarizeMessage(msg, model);
  }

  return { demo: false, listModels, stream };
}

// Turn SDK errors into a status code and a message a person can act on.
export function describeError(err, model) {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: 'The Claude API rejected the API key. Check PIXEL_PARLEY_API_KEY or ANTHROPIC_API_KEY.' };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { status: 403, message: `This API key is not allowed to use ${model}. Pick another model for this agent.` };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { status: 404, message: `Model ${model} is not available to this API key. Pick another model for this agent.` };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Rate limited by the Claude API. Wait a moment, then press Resume.' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `The Claude API rejected the request: ${err.message}` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: 'Could not reach the Claude API. Check your internet connection, then press Resume.' };
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) {
      return { status: 529, message: 'Claude is overloaded right now. Wait a moment, then press Resume.' };
    }
    return { status: err.status || 500, message: err.message || 'Claude API error' };
  }
  return { status: (err && Number.isInteger(err.status) && err.status) || 500, message: (err && err.message) || 'Unknown error' };
}
