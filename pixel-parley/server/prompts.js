// Prompt construction for each speaking turn and for the recap.
//
// Every agent sees the conversation from its own point of view: its own past
// lines are `assistant` turns and everyone else's lines are labeled `user`
// content. The history is rebuilt identically each time (including the cue that
// preceded each past line), so the prompt prefix stays byte-stable and prompt
// caching keeps working as the conversation grows.

import { getFigure } from '../shared/figures.js';
import { MODERATOR } from '../shared/turns.js';

export const LENGTH_RULES = {
  short: 'Keep each turn brief: one to three sentences, under 50 words.',
  medium: 'Keep each turn to one short paragraph, roughly 50 to 110 words.',
  long: 'Each turn can be one or two paragraphs, roughly 120 to 220 words.',
};

const OPEN_AGENDA =
  'There is no set topic. This is an open-ended conversation: follow your curiosity, raise the questions you care about most, and let the discussion go wherever it gets interesting.';

const PERSONA_LIMITS =
  'Limits that override the portrayal: no slurs or dehumanizing language about any group; never glorify, excuse or deny atrocities; no instructions for violence or other real-world harm; no invented factual claims about real living people. If the figure held hateful views, convey them in a historically framed way that helps others understand and challenge them, never as persuasive propaganda.';

const INTRO = "[The roundtable has begun. Each contribution below is labeled with the speaker's name.]";

export function rosterLine(p, { withModel = false } = {}) {
  let line;
  if (p.kind === 'preset') {
    const f = getFigure(p.presetId);
    line = `${p.name} (${f.era}): ${f.tagline}`;
  } else if (p.kind === 'custom') {
    const notes = (p.notes || '').replace(/\s+/g, ' ').trim();
    line = `${p.name}${notes ? `: ${notes.length > 140 ? notes.slice(0, 137) + '...' : notes}` : ''}`;
  } else {
    return `${p.name}: an AI model made by Anthropic (${p.model}), taking part as itself`;
  }
  return withModel ? `${line} [voiced by ${p.modelName || p.model}]` : line;
}

function knowledgeRule(p, knowledge) {
  if (p.kind === 'custom') {
    return knowledge === 'aware'
      ? 'This gathering takes place outside of time: you may know about events after their lifetime, but their values, temperament and way of speaking stay their own.'
      : 'If they lived in the past, you know only what they could have known in their lifetime; react to anything later with curiosity or skepticism instead of pretending to know it.';
  }
  const f = getFigure(p.presetId);
  if (f.knowledgeNote) return f.knowledgeNote;
  if (f.living) return 'Speak from what is publicly known about the world up to the present day, as far as your knowledge goes.';
  if (knowledge === 'aware') {
    return `This gathering takes place outside of time, and you have been able to learn what happened in the world after ${f.knowledge}; you may refer to it. Your values, temperament and way of speaking remain entirely ${f.name}'s own.`;
  }
  return `You know only what ${f.name} could have known in their lifetime, up to ${f.knowledge}. If others mention later people, events or inventions, react as ${f.name} would on first hearing of them (with curiosity, skepticism or questions) instead of pretending to already know. This gathering takes place outside of time, so you may be curious about the others and their eras.`;
}

function identityBlock(p, knowledge) {
  if (p.kind === 'model') {
    return `Who you are:
You are ${p.name} (model id: ${p.model}), an AI model made by Anthropic, taking part as yourself rather than playing a character. Speak in your own voice: thoughtful, candid and curious, with opinions of your own. Some participants may be portrayals of historical or mythical figures; engage with them on their own terms. If other AI models are at the table, compare perspectives honestly and skip the mutual flattery.`;
  }
  if (p.kind === 'custom') {
    const notes = (p.notes || '').trim();
    return `Who you are:
You are playing ${p.name}. Portray them as faithfully as possible: their documented beliefs, values, temperament, knowledge and manner of speaking, based on their own words, reliable sources, or the stories and traditions they come from.${notes ? `\nNotes from the host about this figure: ${notes}` : ''}
${knowledgeRule(p, knowledge)}`;
  }
  const f = getFigure(p.presetId);
  const sources =
    f.kind === 'religious' || f.kind === 'mythic'
      ? 'the texts and traditions in which they appear, and reliable scholarship'
      : 'their own writings and recorded words, and reliable historical sources';
  return `Who you are:
Your role is ${f.name} (${f.era}). Portray this figure as faithfully as possible (documented beliefs, values, temperament, knowledge and manner of speaking), drawing on ${sources}.

${f.persona}

${knowledgeRule(p, knowledge)}`;
}

export function buildSystemPrompt({ participants, speaker, agenda, length = 'medium', knowledge = 'era' }) {
  const me = participants[speaker];
  const roster = participants
    .map((p, i) => `${i + 1}. ${rosterLine(p)}${i === speaker ? '   <- this is you' : ''}`)
    .join('\n');
  const persona = me.kind !== 'model';
  const rules = [
    '- This is a spoken conversation. Reply with only the words you say aloud: no name label, no stage directions or actions, no narration, no markdown, no lists.',
    `- ${LENGTH_RULES[length] || LENGTH_RULES.medium}`,
    '- Respond to what the others actually said. Address people by name, agree or push back, ask pointed questions, and build on ideas instead of repeating them.',
    "- Never write lines for anyone else, and don't summarize the whole discussion unless asked.",
    '- A human moderator may interject now and then; acknowledge their steer and follow it.',
  ];
  if (persona) {
    rules.push('- Stay fully in character for the whole conversation. Never mention being an AI, a language model or a simulation.');
    rules.push(`- ${PERSONA_LIMITS}`);
  }
  return [
    `You are one of ${participants.length} participants in "Pixel Parley", a live roundtable conversation staged as a retro pixel-art video game. Everyone at the table, in seating order:\n${roster}`,
    identityBlock(me, knowledge),
    `Agenda:\n${agenda && agenda.trim() ? agenda.trim() : OPEN_AGENDA}`,
    `How to take your turn:\n${rules.join('\n')}`,
  ].join('\n\n');
}

export function defaultCue(p) {
  return `(It's your turn, ${p.name}.)`;
}

export function makeCue({ participants, transcript, speaker, agenda, turnNumber, totalTurns }) {
  const me = participants[speaker];
  const notes = [];
  const someoneSpoke = transcript.some((e) => e.speaker !== MODERATOR && !e.refused && e.text);
  if (!someoneSpoke) {
    notes.push(
      agenda && agenda.trim()
        ? 'You speak first: open the conversation on the agenda, briefly, in a way that invites the others in.'
        : 'You speak first: open the conversation, briefly, in a way that invites the others in.',
    );
  }
  const remaining = totalTurns - turnNumber;
  if (remaining <= 0) {
    notes.push('This is the final turn of the conversation: respond to the others and close it with your parting thoughts.');
  } else if (remaining < participants.length) {
    notes.push('The conversation is nearing its end, so start drawing your thoughts together.');
  }
  return `(It's your turn, ${me.name}.${notes.length ? ' ' + notes.join(' ') : ''})`;
}

export function speakerName(entry, participants) {
  return entry.speaker === MODERATOR ? 'Moderator (the human host)' : participants[entry.speaker].name;
}

export function buildTurnMessages({ participants, transcript, speaker, cue }) {
  const me = participants[speaker];
  const messages = [];
  let pending = [];
  let first = true;

  const flush = (cueText) => {
    const parts = [];
    if (first) {
      parts.push(INTRO);
      first = false;
    }
    if (pending.length) parts.push(pending.map((e) => `${speakerName(e, participants)}: ${e.text}`).join('\n\n'));
    parts.push(cueText);
    messages.push({ role: 'user', content: parts.join('\n\n') });
    pending = [];
  };

  for (const entry of transcript) {
    if (entry.refused || !entry.text) continue; // a declined turn is silence
    if (entry.speaker === speaker) {
      flush(entry.cue || defaultCue(me));
      messages.push({ role: 'assistant', content: entry.text });
    } else {
      pending.push(entry);
    }
  }
  flush(cue);
  return messages;
}

// ---------------------------------------------------------------------------
// Cleaning model output

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function labelsFor(p) {
  const labels = new Set([p.name, p.short, ...(p.aliases || [])].filter((l) => l && l.length >= 2));
  return [...labels].sort((a, b) => b.length - a.length);
}

const LEADING_DIRECTIONS =
  /^(?:\s*(?:\*[^*\n]{1,80}\*|_[^_\n]{1,80}_|\([^)\n]{1,80}\)|\[[^\]\n]{1,80}\]))+\s*/u;

export function stripLeadingLabel(text, labels) {
  if (!labels.length) return text;
  const re = new RegExp(
    `^\\s*(?:\\*\\*|__)?\\s*(?:${labels.map(escapeRegExp).join('|')})\\s*(?:\\*\\*|__)?\\s*[:：]\\s*(?:\\*\\*|__)?\\s*`,
    'iu',
  );
  return text.replace(re, '');
}

export function stripLeadingDirections(text) {
  return text.replace(LEADING_DIRECTIONS, '');
}

export function cleanReply(raw, participants, speaker) {
  let text = String(raw || '').replace(/\r\n/g, '\n').trim();
  const me = participants[speaker];
  text = stripLeadingLabel(text, labelsFor(me));
  text = stripLeadingDirections(text);

  // Cut anything the model wrote on behalf of someone else ("\nCaesar: ...").
  const others = participants.filter((_, i) => i !== speaker).flatMap(labelsFor);
  others.push('Moderator');
  const otherLine = new RegExp(
    `\\n\\s*(?:\\*\\*|__)?(?:${others.map(escapeRegExp).join('|')})(?:\\*\\*|__)?\\s*[:：]`,
    'u',
  );
  const cut = text.search(otherLine);
  if (cut > 0) text = text.slice(0, cut);

  text = text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '');

  const quoted = /^["“]([\s\S]*)["”]$/.exec(text.trim());
  if (quoted && !/["“”]/.test(quoted[1])) text = quoted[1];

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// If a reply was cut off by the token limit, end it at the last full sentence.
export function trimToSentence(text) {
  const t = text.trim();
  if (!t || /[.!?…]["”'’)\]]*$/.test(t)) return t;
  const re = /[.!?…]["”'’)\]]*(?=\s|$)/g;
  let lastEnd = -1;
  let m;
  while ((m = re.exec(t))) lastEnd = m.index + m[0].length;
  if (lastEnd >= t.length * 0.4) return t.slice(0, lastEnd);
  return t + '…';
}

// Wraps the streaming callback so a leading "Name:" label or "*smiles*" stage
// direction never reaches the screen. Holds back the first few dozen characters.
export function createReplyStreamer(participants, speaker, emit, { hold = 60 } = {}) {
  const labels = labelsFor(participants[speaker]);
  let buffer = '';
  let started = false;

  const release = () => {
    started = true;
    let out = buffer.replace(/^\s+/, '');
    out = stripLeadingDirections(stripLeadingLabel(out, labels));
    buffer = '';
    if (out) emit(out);
  };

  return {
    push(delta) {
      if (started) {
        if (delta) emit(delta);
        return;
      }
      buffer += delta;
      if (buffer.length >= hold || /\n/.test(buffer.trimStart())) release();
    },
    flush() {
      if (!started) release();
    },
  };
}

// ---------------------------------------------------------------------------
// Recap

export function buildRecapRequest({ participants, transcript, agenda }) {
  const roster = participants.map((p) => `- ${rosterLine(p, { withModel: true })}`).join('\n');
  const lines = transcript
    .filter((e) => !e.refused && e.text)
    .map((e, i) => `[${i + 1}] ${speakerName(e, participants)}: ${e.text}`)
    .join('\n\n');

  const system =
    'You write vivid, accurate recaps of roundtable conversations staged in a retro video game called Pixel Parley. Stay faithful to what was actually said: never invent claims, and quote only exact words from the transcript.';

  const user = `Agenda: ${agenda && agenda.trim() ? agenda.trim() : 'Open-ended conversation (no set topic)'}

Participants:
${roster}

<transcript>
${lines || '(no lines yet)'}
</transcript>

Write a recap of this conversation in Markdown, using exactly these sections:

## Headline
One punchy line, like a newspaper headline.

## In Brief
Two or three sentences on what the conversation was really about and where it ended up.

## Key Moments
Three to six bullets, in order.

## Where Everyone Stood
One bullet per participant: **Name**: their position and how it shifted, in one or two sentences.

## Common Ground
One to four bullets.

## Clashes
One to four bullets naming who disagreed with whom, and about what.

## Best Lines
Two to four bullets, each an exact short quote followed by an em dash and the speaker's name.

## Open Questions
One to three bullets.

Keep the whole recap under 450 words. If the transcript is short, keep sections brief rather than padding them.`;

  return { system, messages: [{ role: 'user', content: user }] };
}
