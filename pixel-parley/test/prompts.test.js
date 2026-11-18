import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemPrompt,
  buildTurnMessages,
  makeCue,
  cleanReply,
  trimToSentence,
  createReplyStreamer,
  buildRecapRequest,
} from '../server/prompts.js';
import { normalizeCast } from '../shared/cast.js';
import { MODERATOR } from '../shared/turns.js';

const cast = normalizeCast([
  { kind: 'preset', presetId: 'gandhi', model: 'claude-opus-5-5' },
  { kind: 'preset', presetId: 'caesar', model: 'claude-haiku-5-5' },
  { kind: 'model', model: 'claude-sonnet-5-5', modelName: 'Claude Sonnet 5.5' },
  { kind: 'custom', name: 'Marie Curie', notes: 'Physicist and chemist.', model: 'claude-opus-5-5' },
]);

test('system prompt for a figure includes persona, roster, agenda and limits', () => {
  const s = buildSystemPrompt({ participants: cast, speaker: 1, agenda: 'Does power corrupt?', length: 'short' });
  assert.match(s, /Julius Caesar/);
  assert.match(s, /Rubicon/);
  assert.match(s, /Mahatma Gandhi \(1869–1948, India\)/);
  assert.match(s, /<- this is you/);
  assert.match(s, /Does power corrupt\?/);
  assert.match(s, /under 50 words/);
  assert.match(s, /Stay fully in character/);
  assert.match(s, /no slurs/);
  assert.match(s, /Ides of March, 44 BCE/);
});

test('system prompt for a model agent speaks as itself, with no persona limits', () => {
  const s = buildSystemPrompt({ participants: cast, speaker: 2, agenda: '' });
  assert.match(s, /You are Claude Sonnet 5\.5 \(model id: claude-sonnet-5-5\)/);
  assert.match(s, /There is no set topic/);
  assert.doesNotMatch(s, /Stay fully in character/);
});

test('knowledge mode switches between era-only and aware', () => {
  const era = buildSystemPrompt({ participants: cast, speaker: 0, agenda: '', knowledge: 'era' });
  const aware = buildSystemPrompt({ participants: cast, speaker: 0, agenda: '', knowledge: 'aware' });
  assert.match(era, /You know only what Mahatma Gandhi could have known/);
  assert.match(aware, /you have been able to learn what happened in the world after/);
});

test('custom figures include the host notes', () => {
  const s = buildSystemPrompt({ participants: cast, speaker: 3, agenda: '' });
  assert.match(s, /You are playing Marie Curie/);
  assert.match(s, /Physicist and chemist\./);
});

test('cues mark the opening and the ending', () => {
  const open = makeCue({ participants: cast, transcript: [], speaker: 0, agenda: 'X', turnNumber: 1, totalTurns: 10 });
  assert.match(open, /You speak first/);
  const end = makeCue({ participants: cast, transcript: [{ speaker: 0, text: 'hi' }], speaker: 1, agenda: '', turnNumber: 10, totalTurns: 10 });
  assert.match(end, /final turn/);
  const near = makeCue({ participants: cast, transcript: [{ speaker: 0, text: 'hi' }], speaker: 1, agenda: '', turnNumber: 8, totalTurns: 10 });
  assert.match(near, /nearing its end/);
});

test('turn messages alternate roles and start with the user', () => {
  const t = [
    { speaker: 0, text: 'G1', cue: 'cue-g1' },
    { speaker: 1, text: 'C1', cue: 'cue-c1' },
    { speaker: MODERATOR, text: 'Be brief.' },
    { speaker: 0, text: 'G2', cue: 'cue-g2' },
  ];
  const msgs = buildTurnMessages({ participants: cast, transcript: t, speaker: 0, cue: 'NOW' });
  assert.deepEqual(
    msgs.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant', 'user'],
  );
  assert.match(msgs[0].content, /roundtable has begun/);
  assert.match(msgs[0].content, /cue-g1$/);
  assert.equal(msgs[1].content, 'G1');
  assert.match(msgs[2].content, /Julius Caesar: C1/);
  assert.match(msgs[2].content, /Moderator \(the human host\): Be brief\./);
  assert.match(msgs[4].content, /NOW$/);
});

test('history replays byte-identically, so the cache prefix stays stable', () => {
  const t1 = [{ speaker: 1, text: 'C1', cue: 'c' }];
  const before = buildTurnMessages({ participants: cast, transcript: t1, speaker: 0, cue: 'CUE-A' });
  const t2 = [...t1, { speaker: 0, text: 'G1', cue: 'CUE-A' }, { speaker: 1, text: 'C2', cue: 'c' }];
  const after = buildTurnMessages({ participants: cast, transcript: t2, speaker: 0, cue: 'CUE-B' });
  assert.deepEqual(after.slice(0, before.length), before);
});

test('declined turns are treated as silence', () => {
  const t = [
    { speaker: 1, text: '', refused: true },
    { speaker: 2, text: 'Hello' },
  ];
  const msgs = buildTurnMessages({ participants: cast, transcript: t, speaker: 0, cue: 'GO' });
  assert.equal(msgs.length, 1);
  assert.doesNotMatch(msgs[0].content, /Julius Caesar:/);
});

test('cleanReply strips labels, stage directions and lines for others', () => {
  assert.equal(cleanReply('**Julius Caesar:** Veni, vidi, vici.', cast, 1), 'Veni, vidi, vici.');
  assert.equal(cleanReply('Caesar: I came.', cast, 1), 'I came.');
  assert.equal(cleanReply('*adjusts laurel* Friends, listen.', cast, 1), 'Friends, listen.');
  assert.equal(cleanReply('I came.\n\nMahatma Gandhi: And I walked.', cast, 1), 'I came.');
  assert.equal(cleanReply('"Quoted whole reply."', cast, 1), 'Quoted whole reply.');
  assert.equal(cleanReply('A **bold** point.', cast, 1), 'A bold point.');
});

test('trimToSentence ends at the last full sentence', () => {
  const long = 'The first sentence is long enough. So is the second one, really. And then it stops mid';
  assert.equal(trimToSentence(long), 'The first sentence is long enough. So is the second one, really.');
  assert.equal(trimToSentence('All complete!'), 'All complete!');
  // cutting would lose most of the reply, so keep it and mark the cut
  assert.equal(trimToSentence('Short. Then a much longer fragment that never finishes'), 'Short. Then a much longer fragment that never finishes…');
  assert.equal(trimToSentence('no punctuation at all'), 'no punctuation at all…');
});

test('the reply streamer hides a leading name label', () => {
  const out = [];
  const s = createReplyStreamer(cast, 1, (t) => out.push(t), { hold: 20 });
  for (const chunk of ['Julius ', 'Caesar: ', 'The die ', 'is cast.']) s.push(chunk);
  s.flush();
  assert.equal(out.join(''), 'The die is cast.');
});

test('recap request includes roster, agenda and numbered transcript', () => {
  const { system, messages } = buildRecapRequest({
    participants: cast,
    transcript: [{ speaker: 0, text: 'Truth first.' }, { speaker: MODERATOR, text: 'Thanks.' }],
    agenda: 'Truth',
  });
  assert.match(system, /quote only exact words/);
  assert.match(messages[0].content, /Agenda: Truth/);
  assert.match(messages[0].content, /\[1\] Mahatma Gandhi: Truth first\./);
  assert.match(messages[0].content, /voiced by Claude Opus 5\.5/);
  assert.match(messages[0].content, /## Best Lines/);
});
