// Pixel Parley front end: wires the stage, dialog, setup panel, conversation
// runner, log, recap and saved sessions together.

import { getJSON, sendJSON, postStream } from './api.js';
import { Stage, SLOT_COLORS, STAGE_W, STAGE_H } from './stage.js';
import { Dialog } from './dialog.js';
import { Conversation, slotOf, slimEntry, saveSession } from './conversation.js';
import { Setup, defaultConfig } from './setup.js';
import { renderMarkdown, escapeHtml } from './markdown.js';
import { sessionToMarkdown, download, slugify, estimateCost } from './exporters.js';
import { setSoundEnabled, blip, jingle } from './audio.js';
import { loadPref, savePref } from './storage.js';
import { lookForParticipant } from './sprites.js';
import { getFigure } from '../../shared/figures.js';
import { MODERATOR, speakingTurns } from '../../shared/turns.js';
import { catalogEntry, prettyModelName } from '../../shared/models.js';

const $ = (id) => document.getElementById(id);

const app = {
  demo: false,
  models: [],
  modelsByBackend: {},
  backends: [],
  defaultModel: 'claude-opus-5-5',
  view: null, // the session shown in Log / Recap
  nextWaiter: null,
  recapAbort: null,
};

let stage;
let dialog;
let convo;
let setup;

// ------------------------------------------------------------------ helpers

function modelInfo(id) {
  const lists = [app.modelsByBackend.api || [], ...Object.values(app.modelsByBackend)];
  for (const list of lists) {
    const m = list.find((x) => x.id === id);
    if (m) return m;
  }
  return catalogEntry(id) || { id, name: prettyModelName(id), price: null };
}

function currentBackend() {
  return setup.getConfig().backend;
}

function updateBadge() {
  const badge = $('mode-badge');
  const backend = currentBackend();
  badge.hidden = backend === 'api';
  badge.textContent = backend === 'claude-code' ? 'SUBSCRIPTION' : 'DEMO MODE';
  badge.style.background = backend === 'claude-code' ? 'var(--cyan)' : '';
}

function shortModel(id) {
  return modelInfo(id).name.replace(/^Claude\s+/, '');
}

function metaFor(p, entry) {
  let meta = p.kind === 'model' ? shortModel(p.model) : `voiced by ${shortModel(p.model)}`;
  if (entry && entry.fellBack && entry.servedBy && entry.servedBy !== p.model) {
    meta += ` · answered by ${shortModel(entry.servedBy)} (safety fallback)`;
  }
  return meta;
}

function declinedText(p, category) {
  return `(${p.name} stays silent: the model declined this turn${category ? ` [${category}]` : ''}.)`;
}

function newSessionId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeTitle(agenda, participants) {
  const a = agenda.trim();
  if (a) return a.length > 90 ? a.slice(0, 87) + '…' : a;
  return participants.map((p) => p.name).join(' · ');
}

function sleepOrNext(ms, signal) {
  return new Promise((resolve) => {
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      if (app.nextWaiter === done) app.nextWaiter = null;
      dialog.setReady(false);
      resolve();
    };
    if (Number.isFinite(ms)) timer = setTimeout(done, ms);
    app.nextWaiter = done;
    signal.addEventListener('abort', done, { once: true });
  });
}

// After each turn: let the typewriter finish, then pause for reading time (or
// wait for the ▼ button when auto-advance is off).
async function awaitReadiness(entry, signal) {
  await dialog.waitRevealed(signal);
  if (signal.aborted) return;
  if ($('auto-advance').checked) {
    const words = (entry.text || '').split(/\s+/).filter(Boolean).length;
    await sleepOrNext(Math.min(6500, 900 + words * 40), signal);
  } else {
    await sleepOrNext(Infinity, signal);
  }
}

function advance() {
  if (dialog.isRevealing()) dialog.skip();
  else if (app.nextWaiter) app.nextWaiter();
}

// ------------------------------------------------------------------ layout

function fitStage() {
  const col = document.querySelector('.stage-col');
  const avail = Math.max(160, col.clientWidth - 12);
  const dpr = window.devicePixelRatio || 1;
  const maxH = Math.max(STAGE_H, window.innerHeight - 330);
  let device = Math.floor(Math.min(avail / STAGE_W, maxH / STAGE_H) * dpr);
  let css = device >= 1 ? device / dpr : avail / STAGE_W;
  if (STAGE_W * css > avail) css = avail / STAGE_W;
  const w = Math.round(STAGE_W * css);
  const canvas = $('stage');
  canvas.style.width = `${w}px`;
  canvas.style.height = `${Math.round(STAGE_H * css)}px`;
  $('screen').style.width = `${w + 6}px`;
}

// ------------------------------------------------------------------ state → UI

const STATE_LABELS = {
  idle: 'READY',
  running: 'RUNNING',
  paused: 'PAUSED',
  finished: 'FINISHED',
  replaying: 'REPLAY',
};

function updateControls() {
  const st = convo.state;
  const running = st === 'running' || st === 'paused';
  $('start-btn').disabled = convo.active;
  $('start-btn').textContent = convo.session && st === 'finished' ? '▶ NEW PARLEY' : '▶ START';
  $('pause-btn').disabled = !running;
  $('pause-btn').textContent = st === 'paused' ? '▶ RESUME' : '❚❚ PAUSE';
  $('step-btn').disabled = st !== 'paused';
  $('stop-btn').disabled = !convo.active;
  $('more-btn').disabled = !(convo.session && (running || st === 'finished'));
  $('moderator-input').disabled = !running;
  $('moderator-send').disabled = !running;
  $('state-label').textContent = STATE_LABELS[st] || st.toUpperCase();
  $('state-label').dataset.state = st;
  stage.setStatus(st === 'idle' ? 'ready' : st === 'finished' && !convo.session ? 'ready' : st);
  setup.setLocked(convo.active);
  for (const b of document.querySelectorAll('[data-saved-action]')) b.disabled = convo.active;
}

function updateProgress() {
  const s = convo.session;
  if (!s) {
    const turns = setup.getConfig().turns;
    $('turn-counter').textContent = `TURN 0/${turns}`;
    stage.setProgress(0, turns);
    return;
  }
  const done = speakingTurns(s.transcript);
  $('turn-counter').textContent = `TURN ${done}/${s.totalTurns}`;
  stage.setProgress(done, s.totalTurns);
}

function updateCost() {
  const s = app.view;
  const el = $('cost-meter');
  const backend = s && ((s.settings && s.settings.backend) || (s.demo ? 'demo' : 'api'));
  if (!s || backend !== 'api') {
    el.textContent = '';
    return;
  }
  const cost = estimateCost(s, (id) => modelInfo(id).price);
  el.textContent = cost == null ? '' : `≈ $${cost < 0.1 ? cost.toFixed(3) : cost.toFixed(2)}`;
}

function previewCast() {
  stage.setCast(setup.getCast());
  stage.setActive(-1, null);
  updateProgress();
}

// ------------------------------------------------------------------ log

function logItem(session, entry) {
  const li = document.createElement('li');
  li.className = 'log-entry';
  const meta = document.createElement('div');
  meta.className = 'log-meta';
  const name = document.createElement('span');
  name.className = 'log-name';
  const text = document.createElement('p');
  text.className = 'log-text';
  if (entry.speaker === MODERATOR) {
    li.classList.add('moderator');
    name.textContent = 'MODERATOR';
    meta.append(name);
  } else {
    const p = session.participants[entry.speaker];
    li.style.setProperty('--c', SLOT_COLORS[entry.speaker % SLOT_COLORS.length]);
    name.textContent = p.name.toUpperCase();
    const model = document.createElement('span');
    model.className = 'log-model';
    model.textContent = metaFor(p, entry);
    meta.append(name, model);
    if (entry.turn) {
      const turn = document.createElement('span');
      turn.className = 'log-turn';
      turn.textContent = `#${entry.turn}`;
      meta.append(turn);
    }
  }
  if (entry.refused) {
    text.classList.add('declined');
    text.textContent = '(declined to continue)';
  } else {
    text.textContent = entry.text;
  }
  li.append(meta, text);
  return li;
}

function renderLog(session) {
  const list = $('log-list');
  list.textContent = '';
  $('log-title').textContent = session ? session.title : '';
  $('log-empty').hidden = Boolean(session && session.transcript.length);
  $('log-empty').textContent = session ? 'Waiting for the first line…' : 'No conversation yet. Press START to begin.';
  if (session) for (const e of session.transcript) list.append(logItem(session, e));
}

function appendLog(session, entry) {
  if (session !== app.view) return;
  $('log-empty').hidden = true;
  const li = logItem(session, entry);
  $('log-list').append(li);
  if (!$('panel-log').hidden) li.scrollIntoView({ block: 'nearest' });
}

// ------------------------------------------------------------------ recap

function renderRecap(session) {
  const body = $('recap-body');
  if (session && session.recap) {
    body.innerHTML = renderMarkdown(session.recap);
    $('recap-hint').textContent = `Recap by ${modelInfo(session.recapModel || setup.getConfig().recapModel).name}.`;
    $('recap-download').disabled = false;
  } else {
    body.innerHTML = '';
    $('recap-hint').textContent = session
      ? 'Generate a recap of this conversation with the recap model chosen in Setup.'
      : 'Have a conversation first, then generate a recap here.';
    $('recap-download').disabled = true;
  }
}

async function generateRecap() {
  const s = app.view;
  if (!s || !speakingTurns(s.transcript)) {
    $('recap-hint').textContent = 'Have a conversation first: there is nothing to recap yet.';
    return;
  }
  const model = (s.settings && s.settings.recapModel) || setup.getConfig().recapModel || app.defaultModel;
  const body = $('recap-body');
  const button = $('recap-btn');
  let text = '';
  let done = null;
  let error = null;
  let frame = 0;
  const paint = () => {
    frame = 0;
    body.innerHTML = renderMarkdown(text);
  };
  body.innerHTML = '';
  button.disabled = true;
  $('recap-download').disabled = true;
  $('recap-hint').textContent = `Writing a recap with ${modelInfo(model).name}…`;
  app.recapAbort = new AbortController();
  try {
    await postStream(
      '/api/recap',
      {
        participants: s.participants.map(slotOf),
        transcript: s.transcript.map(slimEntry),
        agenda: s.agenda,
        model,
        backend: (s.settings && s.settings.backend) || currentBackend(),
      },
      {
        signal: app.recapAbort.signal,
        onEvent: (event, data) => {
          if (event === 'delta') {
            text += data.text;
            if (!frame) frame = requestAnimationFrame(paint);
          } else if (event === 'done') done = data;
          else if (event === 'error') error = data;
        },
      },
    );
  } catch (err) {
    error = { message: err.message };
  }
  if (frame) cancelAnimationFrame(frame);
  button.disabled = false;
  if (error || !done) {
    body.innerHTML = `<p class="error">${escapeHtml((error && error.message) || 'The recap did not finish.')}</p>`;
    $('recap-hint').textContent = 'Something went wrong. Try again in a moment.';
    return;
  }
  if (done.refused || !done.text) {
    body.innerHTML = '<p class="error">The model declined to write this recap. Try a different recap model in Setup.</p>';
    $('recap-hint').textContent = '';
    return;
  }
  s.recap = done.text;
  s.recapModel = done.servedBy || model;
  s.recapUsage = done.usage;
  body.innerHTML = renderMarkdown(s.recap);
  $('recap-hint').textContent = `Recap by ${modelInfo(s.recapModel).name}${done.fellBack ? ' (safety fallback)' : ''}.`;
  $('recap-download').disabled = false;
  updateCost();
  saveSession(s).then(refreshSavedIfVisible, () => {});
}

// ------------------------------------------------------------------ saved sessions

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function refreshSaved() {
  const list = $('saved-list');
  let sessions = [];
  try {
    ({ sessions } = await getJSON('/api/sessions'));
  } catch (err) {
    list.textContent = '';
    $('saved-empty').hidden = false;
    $('saved-empty').textContent = `Could not load saved conversations: ${err.message}`;
    return;
  }
  list.textContent = '';
  $('saved-empty').hidden = sessions.length > 0;
  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = 'saved-item';
    const title = document.createElement('p');
    title.className = 'saved-title';
    title.textContent = s.title;
    const meta = document.createElement('p');
    meta.className = 'saved-meta';
    meta.textContent = `${formatDate(s.updatedAt)} · ${s.turns} turn${s.turns === 1 ? '' : 's'} · ${s.participants.join(', ')}${s.hasRecap ? ' · recap' : ''}`;
    const actions = document.createElement('div');
    actions.className = 'saved-actions';
    const mk = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = `btn small ${cls}`;
      b.textContent = label;
      b.dataset.savedAction = '1';
      b.disabled = convo.active;
      b.addEventListener('click', fn);
      return b;
    };
    actions.append(
      mk('OPEN', () => openSaved(s.id)),
      mk('REPLAY', () => openSaved(s.id, { replay: true })),
      mk('DELETE', () => deleteSaved(s), 'btn-danger'),
    );
    li.append(title, meta, actions);
    list.append(li);
  }
}

function refreshSavedIfVisible() {
  if (!$('panel-saved').hidden) refreshSaved();
}

async function openSaved(id, { replay = false } = {}) {
  if (convo.active) return;
  let session;
  try {
    session = await getJSON(`/api/sessions/${encodeURIComponent(id)}`);
  } catch (err) {
    dialog.show({ name: 'PIXEL PARLEY', text: `Could not open that conversation: ${err.message}`, error: true });
    return;
  }
  session.transcript = session.transcript || [];
  session.settings = { order: 'natural', length: 'medium', effort: 'low', knowledge: 'era', ...(session.settings || {}) };
  session.totalTurns = session.totalTurns || Math.max(1, speakingTurns(session.transcript));
  app.view = session;
  setup.setConfig({
    agenda: session.agenda || '',
    slots: session.participants.map(slotOf),
    turns: session.totalTurns,
    order: session.settings.order,
    length: session.settings.length,
    effort: session.settings.effort,
    knowledge: session.settings.knowledge,
    recapModel: session.settings.recapModel || app.defaultModel,
    backend: session.settings.backend || (session.demo ? 'demo' : 'api'),
  });
  updateBadge();
  stage.setCast(session.participants);
  stage.setActive(-1, null);
  renderLog(session);
  renderRecap(session);
  updateCost();
  selectTab('log');
  if (replay) {
    convo.replay(session);
  } else {
    await convo.load(session);
    dialog.show({
      name: 'PIXEL PARLEY',
      text: `Loaded “${session.title}”. Read it in the Log, press +4 TURNS to keep it going, or REPLAY it from the Saved tab.`,
    });
  }
  updateProgress();
}

async function deleteSaved(s) {
  if (!window.confirm(`Delete “${s.title}”? This cannot be undone.`)) return;
  try {
    await sendJSON(`/api/sessions/${encodeURIComponent(s.id)}`, 'DELETE');
  } catch (err) {
    // a 404 means it is already gone
  }
  refreshSaved();
}

// ------------------------------------------------------------------ tabs

const TABS = ['setup', 'log', 'recap', 'saved'];

function selectTab(name) {
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    const on = t === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
  if (name === 'saved') refreshSaved();
  if (name === 'log') {
    const last = $('log-list').lastElementChild;
    if (last) last.scrollIntoView({ block: 'nearest' });
  }
}

function wireTabs() {
  TABS.forEach((t, i) => {
    const tab = $(`tab-${t}`);
    tab.addEventListener('click', () => selectTab(t));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      selectTab(next);
      $(`tab-${next}`).focus();
    });
  });
}

// ------------------------------------------------------------------ controls

async function startConversation() {
  if (convo.active) return;
  const config = setup.getConfig();
  const participants = setup.getCast();
  const session = {
    id: newSessionId(),
    title: makeTitle(config.agenda, participants),
    createdAt: new Date().toISOString(),
    agenda: config.agenda.trim(),
    demo: config.backend === 'demo',
    settings: {
      backend: config.backend,
      length: config.length,
      effort: config.effort,
      knowledge: config.knowledge,
      order: config.order,
      recapModel: config.recapModel,
    },
    totalTurns: config.turns,
    participants,
    transcript: [],
    recap: null,
  };
  app.view = session;
  stage.setCast(participants);
  renderLog(session);
  renderRecap(session);
  updateCost();
  selectTab('log');
  dialog.show({
    name: 'PIXEL PARLEY',
    text: session.agenda ? `The parley begins. Agenda: ${session.agenda}` : 'The parley begins: an open-ended conversation.',
  });
  await convo.start(session);
  updateProgress();
}

function wireControls() {
  $('start-btn').addEventListener('click', startConversation);
  $('pause-btn').addEventListener('click', () => (convo.state === 'paused' ? convo.resume() : convo.pause()));
  $('step-btn').addEventListener('click', () => convo.step());
  $('stop-btn').addEventListener('click', () => convo.stop());
  $('more-btn').addEventListener('click', () => {
    convo.extend(4);
    updateProgress();
  });
  $('dialog-next').addEventListener('click', advance);

  $('moderator-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('moderator-input');
    const text = input.value.trim();
    if (!text) return;
    convo.interject(text);
    input.value = '';
  });

  const speed = $('speed');
  speed.value = loadPref('speed', 50);
  dialog.setSpeed(Number(speed.value));
  speed.addEventListener('input', () => {
    dialog.setSpeed(Number(speed.value));
    savePref('speed', Number(speed.value));
  });

  const auto = $('auto-advance');
  auto.checked = loadPref('autoAdvance', true);
  auto.addEventListener('change', () => {
    savePref('autoAdvance', auto.checked);
    if (auto.checked && app.nextWaiter && !dialog.isRevealing()) app.nextWaiter();
  });

  const sound = $('sound-btn');
  const setSound = (on) => {
    const actual = setSoundEnabled(on);
    sound.setAttribute('aria-pressed', String(actual));
    sound.textContent = actual ? 'SOUND: ON' : 'SOUND: OFF';
    savePref('sound', actual);
  };
  sound.addEventListener('click', () => setSound(sound.getAttribute('aria-pressed') !== 'true'));
  if (loadPref('sound', false)) {
    // browsers only allow audio after a gesture, so arm it on the first click
    window.addEventListener('pointerdown', () => setSound(true), { once: true });
  }

  $('log-copy').addEventListener('click', async () => {
    if (!app.view) return;
    const btn = $('log-copy');
    try {
      await navigator.clipboard.writeText(sessionToMarkdown(app.view));
      btn.textContent = 'COPIED!';
    } catch {
      btn.textContent = 'COPY FAILED';
    }
    setTimeout(() => (btn.textContent = 'COPY'), 1400);
  });
  $('log-md').addEventListener('click', () => {
    if (app.view) download(`${slugify(app.view.title)}.md`, sessionToMarkdown(app.view), 'text/markdown');
  });
  $('log-json').addEventListener('click', () => {
    if (app.view) download(`${slugify(app.view.title)}.json`, JSON.stringify(app.view, null, 2), 'application/json');
  });
  $('recap-btn').addEventListener('click', generateRecap);
  $('recap-download').addEventListener('click', () => {
    const s = app.view;
    if (s && s.recap) download(`${slugify(s.title)}-recap.md`, `# Recap: ${s.title}\n\n${s.recap}\n`, 'text/markdown');
  });
  $('saved-refresh').addEventListener('click', refreshSaved);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      advance();
    } else if (e.key === 'p' || e.key === 'P') {
      if (convo.state === 'paused') convo.resume();
      else convo.pause();
    }
  });
}

// ------------------------------------------------------------------ conversation events

function speakerLook(p) {
  return lookForParticipant(p);
}

function wireConversation() {
  convo.addEventListener('state', () => {
    updateControls();
    updateProgress();
  });

  convo.addEventListener('turn-start', ({ detail }) => {
    const p = convo.session.participants[detail.speaker];
    stage.setActive(detail.speaker, 'thinking');
    dialog.begin({
      name: p.name.toUpperCase(),
      color: SLOT_COLORS[detail.speaker % SLOT_COLORS.length],
      look: speakerLook(p),
      meta: metaFor(p),
      slot: detail.speaker,
    });
    $('turn-counter').textContent = `TURN ${detail.turnNumber}/${convo.session.totalTurns}`;
  });

  convo.addEventListener('speaking', ({ detail }) => stage.setActive(detail.speaker, 'speaking'));
  convo.addEventListener('delta', ({ detail }) => dialog.push(detail.text));

  convo.addEventListener('turn-end', ({ detail }) => {
    const { entry } = detail;
    const p = convo.session.participants[entry.speaker];
    stage.setActive(entry.speaker, 'speaking');
    dialog.end(entry.refused ? declinedText(p, detail.refusalCategory) : entry.text, metaFor(p, entry));
    appendLog(convo.session, entry);
    updateProgress();
    updateCost();
  });

  convo.addEventListener('turn-error', ({ detail }) => {
    const p = convo.session.participants[detail.speaker];
    stage.setActive(-1, null);
    dialog.show({
      name: p.name.toUpperCase(),
      color: SLOT_COLORS[detail.speaker % SLOT_COLORS.length],
      look: speakerLook(p),
      text: `⚠ ${detail.message}\nPress RESUME to try this turn again.`,
      error: true,
    });
  });

  convo.addEventListener('moderator', ({ detail }) => {
    appendLog(convo.session, detail.entry);
    if (!dialog.isRevealing()) dialog.show({ name: 'MODERATOR', text: detail.entry.text });
  });

  convo.addEventListener('replay-entry', ({ detail }) => {
    const { entry } = detail;
    const s = convo.session;
    const p = s.participants[entry.speaker];
    stage.setActive(entry.speaker, 'speaking');
    dialog.begin({
      name: p.name.toUpperCase(),
      color: SLOT_COLORS[entry.speaker % SLOT_COLORS.length],
      look: speakerLook(p),
      meta: metaFor(p, entry),
      slot: entry.speaker,
    });
    dialog.push(entry.refused ? declinedText(p) : entry.text);
    dialog.end();
    const shown = s.transcript.slice(0, s.transcript.indexOf(entry) + 1);
    stage.setProgress(speakingTurns(shown), s.totalTurns);
    $('turn-counter').textContent = `TURN ${speakingTurns(shown)}/${s.totalTurns}`;
  });

  convo.addEventListener('replay-moderator', ({ detail }) => {
    stage.setActive(-1, null);
    dialog.show({ name: 'MODERATOR', text: detail.entry.text });
  });

  convo.addEventListener('finished', ({ detail }) => {
    stage.setActive(-1, null);
    updateProgress();
    if (detail.session && speakingTurns(detail.session.transcript)) {
      dialog.show({
        name: 'PIXEL PARLEY',
        text: detail.replay
          ? '— END OF REPLAY —'
          : '— THE END —\nRead the full conversation in LOG, or open RECAP for a summary. +4 TURNS keeps it going.',
      });
      if (!detail.replay) jingle();
    }
  });

  convo.addEventListener('saved', refreshSavedIfVisible);
  convo.addEventListener('save-error', ({ detail }) => console.warn('Could not save the conversation:', detail.message));
}

// ------------------------------------------------------------------ tooltip

function tooltipHtml(p) {
  const esc = escapeHtml;
  if (p.kind === 'preset') {
    const f = getFigure(p.presetId);
    return `<strong>${esc(f.name)}</strong>${esc(f.era)}<br><span class="tip-dim">${esc(f.tagline)}</span><br>✦ ${esc(f.artifact.name)}: <span class="tip-dim">${esc(f.artifact.why)}</span><br><span class="tip-dim">Voiced by ${esc(p.modelName)}</span>`;
  }
  if (p.kind === 'custom') {
    return `<strong>${esc(p.name)}</strong>Custom figure<br><span class="tip-dim">Voiced by ${esc(p.modelName)}</span>`;
  }
  return `<strong>${esc(p.name)}</strong>Claude, taking part as itself<br><span class="tip-dim">${esc(p.model)}</span>`;
}

function wireTooltip() {
  const canvas = $('stage');
  const tip = $('tooltip');
  const wrap = $('canvas-wrap');
  let hideTimer = null;
  const showAt = (e) => {
    const i = stage.hitTest(e.clientX, e.clientY);
    if (i < 0) {
      tip.hidden = true;
      canvas.style.cursor = 'default';
      return false;
    }
    canvas.style.cursor = 'help';
    tip.innerHTML = tooltipHtml(stage.cast[i].p);
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const x = Math.min(e.clientX - box.left + 14, box.width - tip.offsetWidth - 6);
    const y = Math.min(e.clientY - box.top + 14, box.height - tip.offsetHeight - 6);
    tip.style.left = `${Math.max(6, x)}px`;
    tip.style.top = `${Math.max(6, y)}px`;
    return true;
  };
  canvas.addEventListener('mousemove', showAt);
  canvas.addEventListener('mouseleave', () => {
    tip.hidden = true;
  });
  // touch screens have no hover: tap a character to see their card for a few seconds
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(hideTimer);
    if (showAt(e)) hideTimer = setTimeout(() => (tip.hidden = true), 3500);
  });
}

// ------------------------------------------------------------------ boot

async function init() {
  stage = new Stage($('stage'));
  stage.start();
  dialog = new Dialog(
    { name: $('dialog-name'), meta: $('dialog-meta'), text: $('dialog-text'), portrait: $('portrait'), next: $('dialog-next') },
    { onTalking: (on) => stage.setTalking(on), onBlip: (slot) => blip(slot) },
  );
  convo = new Conversation({ awaitReadiness });
  setup = new Setup(document, {
    onChange: (config) => {
      savePref('config', config);
      updateBadge();
      if (!convo.active) {
        if (convo.session) convo.load(null);
        previewCast();
      }
    },
  });

  fitStage();
  new ResizeObserver(fitStage).observe(document.querySelector('.stage-col'));
  window.addEventListener('resize', fitStage);

  let info;
  try {
    info = await getJSON('/api/models');
  } catch (err) {
    info = { demo: false, models: [], defaultModel: 'claude-opus-5-5', warning: err.message };
  }
  app.demo = Boolean(info.demo);
  app.models = info.models || [];
  app.defaultModel = info.defaultModel || app.defaultModel;
  const defaultBackend = info.defaultBackend || (app.demo ? 'demo' : 'api');
  app.backends = info.backends || [{ id: defaultBackend, label: defaultBackend }];
  app.modelsByBackend = info.modelsByBackend || { [defaultBackend]: app.models };

  setup.setModels(app.models, app.defaultModel);
  setup.setBackends(app.backends, app.modelsByBackend, defaultBackend);
  const saved = loadPref('config', null);
  // a fresh page load starts on the server's preferred power source
  setup.setConfig({ ...(saved || defaultConfig(app.defaultModel)), backend: defaultBackend });
  updateBadge();

  wireTabs();
  wireControls();
  wireConversation();
  wireTooltip();
  previewCast();
  updateControls();

  const welcome = currentBackend() === 'demo'
    ? 'DEMO MODE: no API key or Claude Code login was found, so the cast reads from a short canned script. Add PIXEL_PARLEY_API_KEY, or install Claude Code and sign in, to bring them to life. Hover over anyone on stage to meet them.'
    : 'Welcome to Pixel Parley! Pick 2 to 6 agents (Claude models, or historical and mythical figures voiced by the model you choose), set an agenda, then press START. Hover over anyone on stage to meet them.';
  dialog.show({ name: 'PIXEL PARLEY', text: info.warning ? `${welcome}\n(Model list unavailable: ${info.warning})` : welcome });
}

init();
