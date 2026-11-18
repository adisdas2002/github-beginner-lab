import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNextSpeaker, mentions, speakingTurns, MODERATOR } from '../shared/turns.js';
import { normalizeCast } from '../shared/cast.js';

const cast = normalizeCast([
  { kind: 'preset', presetId: 'gandhi', model: 'claude-opus-5-5' },
  { kind: 'preset', presetId: 'caesar', model: 'claude-opus-5-5' },
  { kind: 'preset', presetId: 'mlk', model: 'claude-opus-5-5' },
  { kind: 'model', model: 'claude-sonnet-5-5' },
]);

const line = (speaker, text = 'Hello.') => ({ speaker, text });

test('first speaker is seat 0 unless random', () => {
  assert.equal(pickNextSpeaker({ mode: 'natural', participants: cast, transcript: [] }), 0);
  assert.equal(pickNextSpeaker({ mode: 'round-robin', participants: cast, transcript: [] }), 0);
  assert.equal(pickNextSpeaker({ mode: 'random', participants: cast, transcript: [], random: () => 0.99 }), 3);
});

test('round robin goes in seat order and wraps', () => {
  assert.equal(pickNextSpeaker({ mode: 'round-robin', participants: cast, transcript: [line(0)] }), 1);
  assert.equal(pickNextSpeaker({ mode: 'round-robin', participants: cast, transcript: [line(3)] }), 0);
});

test('moderator notes do not count as a speaker', () => {
  const t = [line(1), { speaker: MODERATOR, text: 'Keep going.' }];
  assert.equal(pickNextSpeaker({ mode: 'round-robin', participants: cast, transcript: t }), 2);
  assert.equal(speakingTurns(t), 1);
});

test('random never repeats the previous speaker', () => {
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const next = pickNextSpeaker({ mode: 'random', participants: cast, transcript: [line(2)], random: () => r });
    assert.notEqual(next, 2);
  }
});

test('natural mode answers whoever was addressed', () => {
  const t = [line(0, 'Dr. King, do you agree with me?')];
  assert.equal(pickNextSpeaker({ mode: 'natural', participants: cast, transcript: t }), 2);
});

test('natural mode lets a moderator address someone', () => {
  const t = [line(0), line(1), { speaker: MODERATOR, text: 'Sonnet, what do you make of this?' }];
  assert.equal(pickNextSpeaker({ mode: 'natural', participants: cast, transcript: t }), 3);
});

test('natural mode falls back to whoever waited longest', () => {
  const t = [line(0), line(1), line(2)];
  assert.equal(pickNextSpeaker({ mode: 'natural', participants: cast, transcript: t }), 3);
});

test('natural mode does not starve anyone', () => {
  // Gandhi and Caesar keep addressing each other; the others must get a turn.
  const t = [line(0, 'Caesar?'), line(1, 'Gandhi?'), line(0, 'Caesar?'), line(1, 'Gandhi?')];
  const next = pickNextSpeaker({ mode: 'natural', participants: cast, transcript: t });
  assert.ok(next === 2 || next === 3, `expected a left-out participant, got ${next}`);
});

test('mentions matches whole words and respects case', () => {
  const mlk = cast[2];
  assert.ok(mentions('As Dr. King said...', mlk));
  assert.ok(!mentions('the king of Lu', mlk));
  assert.ok(mentions('Caesar, enough.', cast[1]));
  assert.ok(!mentions('Caesarean logic', cast[1]));
});

test('duplicate figures get unique names', () => {
  const dup = normalizeCast([
    { kind: 'preset', presetId: 'gandhi', model: 'claude-opus-5-5' },
    { kind: 'preset', presetId: 'gandhi', model: 'claude-haiku-5-5' },
  ]);
  assert.equal(dup[0].name, 'Mahatma Gandhi');
  assert.equal(dup[1].name, 'Mahatma Gandhi (2)');
});
