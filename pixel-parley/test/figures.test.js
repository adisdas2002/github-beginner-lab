import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIGURES, getFigure, SCENARIOS, CUSTOM_PROPS } from '../shared/figures.js';
import { buildFrame, lookForParticipant, HAIR, FACIAL, EYEWEAR, OUTFITS, CW, CH } from '../public/js/sprites.js';
import { ARTIFACTS } from '../public/js/artifacts.js';
import { plateText } from '../shared/cast.js';

const REQUESTED = [
  'Mahatma Gandhi',
  'The Buddha',
  'Jesus of Nazareth',
  'Adolf Hitler',
  'Donald Trump',
  'Martin Luther King Jr.',
  'Malcolm X',
  'Krishna',
  'Albert Einstein',
  'Confucius',
  'Niccolò Machiavelli',
  'Leonardo da Vinci',
  'Nicolaus Copernicus',
  'Julius Caesar',
];

test('all fourteen requested figures are presets', () => {
  const names = FIGURES.map((f) => f.name);
  for (const n of REQUESTED) assert.ok(names.includes(n), `missing ${n}`);
  assert.equal(new Set(FIGURES.map((f) => f.id)).size, FIGURES.length);
});

test('each figure is complete', () => {
  for (const f of FIGURES) {
    assert.ok(f.persona.length > 400, `${f.id} persona too short`);
    assert.ok(f.aliases.length >= 1, `${f.id} needs aliases`);
    assert.ok(f.demo.length >= 3, `${f.id} needs demo lines`);
    assert.ok(f.era && f.tagline, `${f.id} needs era and tagline`);
    assert.ok(f.knowledge || f.living || f.knowledgeNote, `${f.id} needs a knowledge limit`);
    assert.ok(ARTIFACTS[f.artifact.id], `${f.id} artifact ${f.artifact.id} is not drawable`);
    assert.ok(f.artifact.name && f.artifact.why, `${f.id} artifact needs a name and reason`);
    assert.equal(plateText(f.short), f.short, `${f.id} nameplate uses unsupported characters`);
    assert.ok(f.short.length <= 12, `${f.id} nameplate too long`);
    const parts = f.look.parts;
    assert.ok(HAIR[parts.hair], `${f.id} hair ${parts.hair}`);
    assert.ok(OUTFITS[parts.outfit], `${f.id} outfit ${parts.outfit}`);
    if (parts.facial) assert.ok(FACIAL[parts.facial], `${f.id} facial ${parts.facial}`);
    if (parts.eyewear) assert.ok(EYEWEAR[parts.eyewear], `${f.id} eyewear ${parts.eyewear}`);
  }
});

test('every artifact is unique to its figure', () => {
  const ids = FIGURES.map((f) => f.artifact.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every sprite renders with an outline, in every animation frame', () => {
  const looks = [
    ...FIGURES.map((f) => lookForParticipant({ kind: 'preset', presetId: f.id })),
    lookForParticipant({ kind: 'model', model: 'claude-opus-5-5' }),
    lookForParticipant({ kind: 'model', model: 'claude-haiku-4-5' }),
    lookForParticipant({ kind: 'custom', name: 'Ada Lovelace', prop: 'scroll' }),
  ];
  for (const look of looks) {
    const frames = ARTIFACTS[look.artifact].frames;
    for (let art = 0; art < frames; art++) {
      for (const state of [{}, { blink: true, mouth: true, talking: true }]) {
        const g = buildFrame(look, { ...state, art });
        assert.equal(g.px.length, CW * CH);
        const filled = g.px.filter(Boolean).length;
        assert.ok(filled > 300, 'sprite looks empty');
        assert.ok(g.px.includes('#140c1c'), 'sprite has no outline');
      }
    }
  }
});

test('blinking and talking change the face', () => {
  const look = lookForParticipant({ kind: 'preset', presetId: 'einstein' });
  const base = buildFrame(look).px.join();
  assert.notEqual(buildFrame(look, { blink: true }).px.join(), base);
  assert.notEqual(buildFrame(look, { mouth: true }).px.join(), base);
});

test('custom looks are deterministic per name', () => {
  const a = lookForParticipant({ kind: 'custom', name: 'Hypatia' });
  const b = lookForParticipant({ kind: 'custom', name: 'Hypatia' });
  assert.deepEqual(a, b);
});

test('scenarios reference real figures and props are drawable', () => {
  for (const sc of SCENARIOS) {
    for (const token of sc.cast) {
      if (token === 'model' || token.startsWith('model:')) continue;
      assert.ok(getFigure(token), `${sc.id} references unknown figure ${token}`);
    }
  }
  for (const p of CUSTOM_PROPS) assert.ok(ARTIFACTS[p.id], `prop ${p.id} is not drawable`);
});
