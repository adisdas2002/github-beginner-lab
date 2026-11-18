// Turns the setup form's "slots" into participants with unique display names.
// Used by the browser (to show names) and by the server (to build prompts), so
// both always agree on who is called what.

import { getFigure } from './figures.js';
import { catalogEntry, prettyModelName, shortModelName } from './models.js';

export const MIN_CAST = 2;
export const MAX_CAST = 6;

// Nameplates use a small bitmap font: plain A–Z, digits and a little punctuation.
export function plateText(text, max = 12) {
  const plain = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .,'!?:()\/+&#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const last = plain.split(' ').pop();
  return (last.length <= max ? last : plain).slice(0, max);
}

function unique(list) {
  return [...new Set(list.filter((x) => x && x.length >= 3))];
}

function modelAliases(name) {
  const bare = name.replace(/^Claude\s+/i, '');
  return unique([name, bare, bare.split(' ')[0]]);
}

function customAliases(name) {
  const words = name.split(/\s+/).filter((w) => w.length >= 3);
  return unique([name, words[0], words[words.length - 1]]);
}

function baseParticipant(slot) {
  const model = slot.model;
  const known = catalogEntry(model);
  const modelName = slot.modelName || (known && known.name) || prettyModelName(model);

  if (slot.kind === 'preset') {
    const f = getFigure(slot.presetId);
    if (!f) throw new Error(`Unknown figure "${slot.presetId}"`);
    return {
      kind: 'preset',
      presetId: f.id,
      model,
      modelName,
      name: f.name,
      short: f.short,
      aliases: f.aliases.slice(),
    };
  }
  if (slot.kind === 'custom') {
    const name = String(slot.name || '').trim() || 'Mystery Guest';
    return {
      kind: 'custom',
      model,
      modelName,
      name,
      short: plateText(name),
      notes: String(slot.notes || '').trim(),
      prop: slot.prop || 'quill',
      aliases: customAliases(name),
    };
  }
  return {
    kind: 'model',
    model,
    modelName,
    name: modelName,
    short: shortModelName(modelName),
    aliases: modelAliases(modelName),
  };
}

export function normalizeCast(slots) {
  const seen = new Map();
  return slots.map((slot) => {
    const p = baseParticipant(slot);
    const n = (seen.get(p.name) || 0) + 1;
    seen.set(p.name, n);
    if (n > 1) {
      p.name = `${p.name} (${n})`;
      p.short = `${p.short.slice(0, 9).trim()} ${n}`;
      p.aliases = [p.name];
    }
    return p;
  });
}
