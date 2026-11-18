// Demo mode: no API key, no network. Lines come from small canned banks so the
// whole game (stage, dialog, log, saved sessions, recap) can be tried and tested
// offline. The UI shows a DEMO badge whenever this provider is active.

import { MODEL_CATALOG } from '../shared/models.js';
import { getFigure } from '../shared/figures.js';
import { MODERATOR } from '../shared/turns.js';

const MODEL_LINES = [
  "Here's my honest take: the interesting question isn't who's right, it's what each of us would need to see to change our minds.",
  "I'd push back gently there. That argument works on paper, but I'm not sure it survives contact with real people.",
  "Let me try to steelman the other side before I disagree with it, because I think it's stronger than it sounded.",
  "I notice we keep circling one assumption without saying it out loud. Can we put it on the table?",
];

const CUSTOM_LINES = [
  'I have lived long enough to distrust easy answers. Let me tell you what my own life taught me.',
  'There is wisdom in what was just said, but it is incomplete. Allow me to add the missing piece.',
  'If my era taught me anything, it is that ideas only matter when someone is willing to act on them.',
];

const OPENERS = [
  'I hear you. But consider this:',
  "that's a fair point. And yet:",
  'let me push back a little.',
  "I agree, and I'd add this:",
];

function linesFor(p) {
  if (p.kind === 'preset') return getFigure(p.presetId).demo;
  if (p.kind === 'model') return MODEL_LINES;
  return CUSTOM_LINES;
}

export function demoLine({ participants, transcript, speaker, agenda, turnNumber, totalTurns }) {
  const me = participants[speaker];
  const mine = transcript.filter((e) => e.speaker === speaker).length;
  const lines = linesFor(me);
  let line = lines[mine % lines.length];

  const spoken = transcript.filter((e) => e.speaker !== MODERATOR && !e.refused);
  const latest = transcript[transcript.length - 1];
  const prev = [...spoken].reverse().find((e) => e.speaker !== speaker);

  if (!spoken.length) {
    line = agenda ? `Shall we begin? The question before us: ${agenda.trim()} ${line}` : `Shall we begin? ${line}`;
  } else if (latest && latest.speaker === MODERATOR) {
    line = `Thank you, moderator. ${line}`;
  } else if (prev) {
    const opener = OPENERS[(mine + speaker) % OPENERS.length];
    line = `${participants[prev.speaker].name}, ${opener} ${line}`;
  }
  if (turnNumber >= totalTurns) line = `${line} That is my parting thought.`;
  return line;
}

function firstSentence(text, max = 120) {
  const s = (text.match(/^.*?[.!?](?=\s|$)/s) || [text])[0].trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function demoRecap({ participants, transcript, agenda }) {
  const turns = transcript.filter((e) => e.speaker !== MODERATOR && !e.refused && e.text);
  const names = participants.map((p) => p.name);
  const nameOf = (e) => participants[e.speaker].name;
  const moments = turns.slice(0, 5).map((e) => `- **${nameOf(e)}**: ${firstSentence(e.text)}`);
  const stances = participants.map((p, i) => {
    const last = [...turns].reverse().find((e) => e.speaker === i);
    return `- **${p.name}**: ${last ? firstSentence(last.text) : 'stayed quiet this time.'}`;
  });
  const quotes = turns.slice(-2).map((e) => `- "${firstSentence(e.text, 90)}" — ${nameOf(e)}`);
  return `## Headline
${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} hold court${agenda ? ` on "${agenda.trim()}"` : ''}

## In Brief
This is a demo recap, built without calling Claude. Add an API key to get a real summary of what was said across ${turns.length} turns.

## Key Moments
${moments.join('\n') || '- No turns yet.'}

## Where Everyone Stood
${stances.join('\n')}

## Common Ground
- Everyone agreed to keep talking, which is a start.

## Clashes
- In demo mode the disagreements are scripted, so draw your own conclusions.

## Best Lines
${quotes.join('\n') || '- (none yet)'}

## Open Questions
- What would these minds say with a real model behind them?`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createDemoProvider({ delayMs = 22, chunk = 3 } = {}) {
  return {
    demo: true,
    async listModels() {
      return MODEL_CATALOG.map((m) => ({ ...m, createdAt: null }));
    },
    async stream({ kind = 'turn', model, meta, signal, onText }) {
      const text = kind === 'recap' ? demoRecap(meta) : demoLine(meta);
      for (let i = 0; i < text.length; i += chunk) {
        if (signal && signal.aborted) {
          const err = new Error('Request was aborted.');
          err.name = 'AbortError';
          throw err;
        }
        if (onText) onText(text.slice(i, i + chunk));
        if (delayMs) await sleep(delayMs);
      }
      return {
        text,
        stopReason: 'end_turn',
        refused: false,
        refusalCategory: null,
        servedBy: model,
        fellBack: false,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
    },
  };
}
