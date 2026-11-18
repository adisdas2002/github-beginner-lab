// Log export (Markdown / JSON), downloads, and a rough cost estimate.

import { MODERATOR, speakingTurns } from '../../shared/turns.js';

export function slugify(s) {
  return (
    String(s || 'parley')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'parley'
  );
}

export function speakerName(entry, session) {
  if (entry.speaker === MODERATOR) return 'Moderator';
  const p = session.participants[entry.speaker];
  return p ? p.name : 'Unknown';
}

export function castLine(session) {
  return session.participants.map((p) => (p.kind === 'model' ? p.name : `${p.name} (voiced by ${p.modelName})`)).join(', ');
}

export function sessionToMarkdown(session) {
  const lines = [`# ${session.title}`, ''];
  lines.push(`- **Date:** ${new Date(session.createdAt || Date.now()).toLocaleString()}`);
  lines.push(`- **Agenda:** ${session.agenda && session.agenda.trim() ? session.agenda.trim() : 'Open-ended discussion'}`);
  lines.push(`- **Cast:** ${castLine(session)}`);
  lines.push(`- **Turns:** ${speakingTurns(session.transcript)} of ${session.totalTurns}`);
  if (session.demo) lines.push('- **Mode:** demo (canned lines, no API calls)');
  lines.push('', '## Transcript', '');
  for (const e of session.transcript) {
    const who = speakerName(e, session);
    if (e.speaker === MODERATOR) lines.push(`> **Moderator:** ${e.text}`);
    else if (e.refused) lines.push(`**${who}:** _(declined to continue)_`);
    else lines.push(`**${who}:** ${e.text}`);
    lines.push('');
  }
  if (session.recap) {
    lines.push('## Recap', '', session.recap.replace(/^##\s/gm, '### '), '');
  }
  lines.push('---', '_Made with Pixel Parley. Figures are AI portrayals, not real quotes._', '');
  return lines.join('\n');
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Rough USD estimate from reported token usage: cache writes at 1.25x and cache
// reads at 0.1x the input price. Returns null when there is nothing to price.
export function estimateCost(session, priceOf) {
  let total = 0;
  let priced = false;
  const add = (usage, model) => {
    const price = usage && priceOf(model);
    if (!price) return;
    priced = true;
    const [pin, pout] = price;
    total +=
      ((usage.input || 0) * pin +
        (usage.cacheWrite || 0) * pin * 1.25 +
        (usage.cacheRead || 0) * pin * 0.1 +
        (usage.output || 0) * pout) /
      1e6;
  };
  for (const e of session.transcript) add(e.usage, e.servedBy || e.model);
  if (session.recapUsage) add(session.recapUsage, session.recapModel);
  return priced ? total : null;
}
