// Request validation. Everything from the browser is checked and normalized
// here before it reaches a prompt or the disk.

import { getFigure } from '../shared/figures.js';
import { MIN_CAST, MAX_CAST, normalizeCast } from '../shared/cast.js';
import { MODERATOR, TURN_MODES } from '../shared/turns.js';

export class ValidationError extends Error {}

const MODEL_RE = /^claude-[a-z0-9][a-z0-9.-]{1,60}$/;
const SAFE_LABEL_RE = /^[\p{L}\p{N} .,'()&+:/-]{1,60}$/u;

const LENGTHS = ['short', 'medium', 'long'];
const EFFORTS = ['low', 'medium', 'high'];
const KNOWLEDGE = ['era', 'aware'];

function fail(msg) {
  throw new ValidationError(msg);
}

function str(value, max, label) {
  if (value == null) return '';
  if (typeof value !== 'string') fail(`${label} must be text.`);
  // drop control characters except newlines and tabs
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (clean.length > max) fail(`${label} is too long (max ${max} characters).`);
  return clean;
}

function int(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function parseModel(value, label = 'Model') {
  const model = str(value, 80, label).trim();
  if (!MODEL_RE.test(model)) fail(`${label} "${model}" is not a valid Claude model id.`);
  return model;
}

export function parseParticipants(list) {
  if (!Array.isArray(list) || list.length < MIN_CAST || list.length > MAX_CAST) {
    fail(`Choose between ${MIN_CAST} and ${MAX_CAST} participants.`);
  }
  const slots = list.map((raw, i) => {
    const label = `Participant ${i + 1}`;
    if (!raw || typeof raw !== 'object') fail(`${label} is missing.`);
    const model = parseModel(raw.model, `${label}'s model`);
    let modelName = str(raw.modelName, 60, `${label}'s model name`).trim();
    if (modelName && !SAFE_LABEL_RE.test(modelName)) modelName = '';
    if (raw.kind === 'preset') {
      if (!getFigure(raw.presetId)) fail(`${label}: unknown figure "${raw.presetId}".`);
      return { kind: 'preset', presetId: raw.presetId, model, modelName };
    }
    if (raw.kind === 'custom') {
      const name = str(raw.name, 60, `${label}'s name`).replace(/\s+/g, ' ').trim();
      if (!name) fail(`${label}: give the custom figure a name.`);
      const notes = str(raw.notes, 1500, `${label}'s notes`).trim();
      const prop = typeof raw.prop === 'string' && /^[a-z]{2,20}$/.test(raw.prop) ? raw.prop : 'quill';
      return { kind: 'custom', name, notes, prop, model, modelName };
    }
    if (raw.kind === 'model') return { kind: 'model', model, modelName };
    return fail(`${label}: unknown kind "${raw.kind}".`);
  });
  return normalizeCast(slots);
}

export function parseTranscript(list, castSize, { maxEntries = 600, keepMeta = false } = {}) {
  if (list == null) return [];
  if (!Array.isArray(list)) fail('Transcript must be a list.');
  if (list.length > maxEntries) fail(`Transcript is too long (max ${maxEntries} entries).`);
  return list.map((e, i) => {
    if (!e || typeof e !== 'object') fail(`Transcript entry ${i + 1} is invalid.`);
    const speaker = e.speaker;
    if (!(speaker === MODERATOR || (Number.isInteger(speaker) && speaker >= 0 && speaker < castSize))) {
      fail(`Transcript entry ${i + 1} has an invalid speaker.`);
    }
    const out = { speaker, text: str(e.text, 8000, `Transcript entry ${i + 1}`) };
    if (e.refused === true) out.refused = true;
    if (typeof e.cue === 'string' && e.cue.length <= 500) out.cue = e.cue;
    if (keepMeta) {
      for (const key of ['model', 'servedBy', 'at']) {
        if (typeof e[key] === 'string' && e[key].length <= 80) out[key] = e[key];
      }
      if (e.fellBack === true) out.fellBack = true;
      if (Number.isInteger(e.turn) && e.turn > 0 && e.turn < 10000) out.turn = e.turn;
      if (e.usage && typeof e.usage === 'object') {
        const u = {};
        for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
          if (Number.isInteger(e.usage[key]) && e.usage[key] >= 0) u[key] = e.usage[key];
        }
        out.usage = u;
      }
    }
    return out;
  });
}

export function parseSettings(s = {}) {
  if (typeof s !== 'object' || s === null) s = {};
  return {
    length: oneOf(s.length, LENGTHS, 'medium'),
    effort: oneOf(s.effort, EFFORTS, 'low'),
    knowledge: oneOf(s.knowledge, KNOWLEDGE, 'era'),
    order: oneOf(s.order, TURN_MODES, 'natural'),
  };
}

export function parseTurnRequest(body) {
  if (!body || typeof body !== 'object') fail('Missing request body.');
  const participants = parseParticipants(body.participants);
  const speaker = int(body.speaker, 0, participants.length - 1, 'Speaker');
  const transcript = parseTranscript(body.transcript, participants.length);
  const agenda = str(body.agenda, 2000, 'Agenda');
  const settings = parseSettings(body.settings);
  const turn = body.turn || {};
  const total = int(turn.total, 1, 1000, 'Total turns');
  const number = int(turn.number, 1, total, 'Turn number');
  return { participants, speaker, transcript, agenda, settings, turn: { number, total } };
}

export function parseRecapRequest(body) {
  if (!body || typeof body !== 'object') fail('Missing request body.');
  const participants = parseParticipants(body.participants);
  const transcript = parseTranscript(body.transcript, participants.length);
  if (!transcript.some((e) => e.speaker !== MODERATOR && e.text)) fail('There is nothing to recap yet.');
  return {
    participants,
    transcript,
    agenda: str(body.agenda, 2000, 'Agenda'),
    model: parseModel(body.model, 'Recap model'),
  };
}

// What gets written to logs/<id>.json
export function sanitizeSession(body) {
  if (!body || typeof body !== 'object') fail('Missing session.');
  const participants = parseParticipants(body.participants);
  const settings = parseSettings(body.settings);
  if (typeof body.settings?.recapModel === 'string' && MODEL_RE.test(body.settings.recapModel)) {
    settings.recapModel = body.settings.recapModel;
  }
  return {
    title: str(body.title, 200, 'Title').trim() || 'Untitled parley',
    agenda: str(body.agenda, 2000, 'Agenda'),
    createdAt: typeof body.createdAt === 'string' && body.createdAt.length <= 40 ? body.createdAt : undefined,
    demo: body.demo === true,
    settings,
    totalTurns: Number.isInteger(body.totalTurns) && body.totalTurns > 0 && body.totalTurns <= 1000 ? body.totalTurns : undefined,
    participants,
    transcript: parseTranscript(body.transcript, participants.length, { maxEntries: 1200, keepMeta: true }),
    recap: body.recap == null ? null : str(body.recap, 30000, 'Recap'),
    recapModel: typeof body.recapModel === 'string' && MODEL_RE.test(body.recapModel) ? body.recapModel : undefined,
  };
}
