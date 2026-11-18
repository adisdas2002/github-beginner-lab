// Who speaks next?
//
// Transcript entries look like { speaker: <participant index>, text } and moderator
// notes use speaker -1. All modes avoid letting the same participant speak twice
// in a row.
//
//  - "round-robin": everyone in seating order.
//  - "random":      anyone except the previous speaker.
//  - "natural":     whoever was just addressed by name answers next; otherwise the
//                   person who has waited longest. Nobody is left out for long.

export const TURN_MODES = ['natural', 'round-robin', 'random'];

export const MODERATOR = -1;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Does `text` address or mention this participant? Aliases match as whole words,
// case-sensitively, so "king" in a sentence doesn't summon Dr. King.
export function mentions(text, participant) {
  if (!text) return false;
  const aliases = participant.aliases && participant.aliases.length ? participant.aliases : [participant.name];
  return aliases.some((alias) => {
    if (!alias || alias.length < 3) return false;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(alias)}($|[^\\p{L}\\p{N}])`, 'u');
    return re.test(text);
  });
}

export function speakingTurns(transcript) {
  return transcript.filter((e) => e.speaker !== MODERATOR).length;
}

export function pickNextSpeaker({ mode = 'natural', participants, transcript, random = Math.random }) {
  const n = participants.length;
  if (n === 0) throw new Error('No participants');
  if (n === 1) return 0;

  const spoken = transcript.filter((e) => e.speaker !== MODERATOR);
  const last = spoken.length ? spoken[spoken.length - 1].speaker : null;

  if (last === null) {
    return mode === 'random' ? Math.floor(random() * n) : 0;
  }
  if (mode === 'round-robin') return (last + 1) % n;

  const candidates = [];
  for (let i = 0; i < n; i++) if (i !== last) candidates.push(i);

  if (mode === 'random') return candidates[Math.floor(random() * candidates.length)];

  // natural
  const lastSpokeAt = new Map();
  spoken.forEach((e, idx) => lastSpokeAt.set(e.speaker, idx));
  // Turns since this participant last spoke; someone who never spoke has waited
  // since the start (one more than anyone who has spoken).
  const waited = (i) => (lastSpokeAt.has(i) ? spoken.length - 1 - lastSpokeAt.get(i) : spoken.length);
  const longestWaiting = (pool) =>
    pool.reduce((best, i) => (waited(i) > waited(best) ? i : best), pool[0]);

  // Anyone left out for a full round goes next, whoever was addressed.
  const starving = candidates.filter((i) => waited(i) >= n);
  if (starving.length) return longestWaiting(starving);

  // Otherwise answer whoever the latest line (a moderator note counts) addressed.
  const latest = transcript[transcript.length - 1];
  const addressed = candidates.filter((i) => mentions(latest.text, participants[i]));
  return longestWaiting(addressed.length ? addressed : candidates);
}
