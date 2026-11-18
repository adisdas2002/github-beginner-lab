// Runs a conversation turn by turn and reports progress through DOM events:
//   state, turn-start, speaking, delta, turn-end, turn-error, moderator,
//   finished, saved, save-error, replay-entry, replay-moderator.
//
// States: idle -> running <-> paused -> finished. "replaying" re-plays a saved
// transcript without calling the API.

import { pickNextSpeaker, speakingTurns, MODERATOR } from '../../shared/turns.js';
import { postStream, sendJSON } from './api.js';

// What the server needs to rebuild a participant (it normalizes names itself).
export function slotOf(p) {
  const slot = { kind: p.kind, model: p.model, modelName: p.modelName };
  if (p.kind === 'preset') slot.presetId = p.presetId;
  if (p.kind === 'custom') Object.assign(slot, { name: p.name, notes: p.notes, prop: p.prop });
  return slot;
}

export function slimEntry(e) {
  const out = { speaker: e.speaker, text: e.text || '' };
  if (e.refused) out.refused = true;
  if (e.cue) out.cue = e.cue;
  return out;
}

let saveChain = Promise.resolve();

// Saves are queued so they reach the server in order.
export function saveSession(session) {
  const payload = {
    title: session.title,
    agenda: session.agenda,
    createdAt: session.createdAt,
    demo: Boolean(session.demo),
    settings: session.settings,
    totalTurns: session.totalTurns,
    participants: session.participants.map(slotOf),
    transcript: session.transcript,
    recap: session.recap || null,
    recapModel: session.recapModel,
  };
  saveChain = saveChain.catch(() => {}).then(() => sendJSON(`/api/sessions/${session.id}`, 'PUT', payload));
  return saveChain;
}

export class Conversation extends EventTarget {
  constructor({ awaitReadiness }) {
    super();
    this.awaitReadiness = awaitReadiness;
    this.session = null;
    this.state = 'idle';
    this.queue = [];
    this.busy = false;
    this.loopPromise = null;
    this.resetFlags();
  }

  resetFlags() {
    this.pauseRequested = false;
    this.stepOnce = false;
    this.stopRequested = false;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', { state });
  }

  get active() {
    return this.state === 'running' || this.state === 'paused' || this.state === 'replaying';
  }

  get turnsTaken() {
    return this.session ? speakingTurns(this.session.transcript) : 0;
  }

  async halt() {
    if (this.loopPromise) {
      this.stop();
      await this.loopPromise;
    }
  }

  async start(session) {
    await this.halt();
    this.session = session;
    this.queue = [];
    this.resetFlags();
    this.setState('running');
    this.save();
    this.loopPromise = this.loop();
  }

  // Show a saved (or no) session without running it.
  async load(session) {
    await this.halt();
    this.session = session;
    this.queue = [];
    this.resetFlags();
    this.setState(session ? 'finished' : 'idle');
  }

  pause() {
    if (this.state === 'running') {
      this.pauseRequested = true;
      this.setState('paused');
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.pauseRequested = false;
      this.setState('running');
      this.wake();
    }
  }

  step() {
    if (this.state === 'paused') {
      this.stepOnce = true;
      this.setState('running');
      this.wake();
    }
  }

  stop() {
    if (!this.active) return;
    this.stopRequested = true;
    if (this.requestAbort) this.requestAbort.abort();
    if (this.loopAbort) this.loopAbort.abort();
    this.wake();
  }

  extend(n) {
    if (!this.session) return;
    this.session.totalTurns += n;
    this.save();
    this.emit('progress');
    if (this.state === 'finished') {
      this.resetFlags();
      this.setState('running');
      this.loopPromise = this.loop();
    }
  }

  interject(text) {
    if (!this.session) return;
    const entry = { speaker: MODERATOR, text, at: new Date().toISOString() };
    if (this.busy) this.queue.push(entry);
    else this.addModerator(entry);
  }

  addModerator(entry) {
    this.session.transcript.push(entry);
    this.emit('moderator', { entry });
    this.save();
  }

  flushQueue() {
    while (this.queue.length) this.addModerator(this.queue.shift());
  }

  wake() {
    const w = this.resumeWaiter;
    this.resumeWaiter = null;
    if (w) w();
  }

  waitForWake() {
    return new Promise((resolve) => {
      this.resumeWaiter = resolve;
    });
  }

  save() {
    if (!this.session) return Promise.resolve();
    return saveSession(this.session).then(
      (summary) => this.emit('saved', { summary }),
      (err) => this.emit('save-error', { message: err.message }),
    );
  }

  async loop() {
    this.loopAbort = new AbortController();
    const signal = this.loopAbort.signal;
    try {
      while (!this.stopRequested) {
        if (this.turnsTaken >= this.session.totalTurns) break;
        if (this.pauseRequested && !this.stepOnce) {
          await this.waitForWake();
          continue;
        }
        const stepping = this.stepOnce;
        this.stepOnce = false;
        this.flushQueue();
        const entry = await this.runTurn();
        if (this.stopRequested) break;
        if (!entry) {
          // the turn failed: pause so the person can retry with Resume
          this.pauseRequested = true;
          this.setState('paused');
          continue;
        }
        await this.awaitReadiness(entry, signal);
        if (stepping && !this.stopRequested) {
          this.pauseRequested = true;
          this.setState('paused');
        }
      }
    } finally {
      this.flushQueue();
      this.resetFlags();
      this.loopPromise = null;
      this.setState('finished');
      this.emit('finished', { session: this.session });
      this.save();
    }
  }

  async runTurn() {
    const s = this.session;
    const turnNumber = this.turnsTaken + 1;
    const speaker = pickNextSpeaker({ mode: s.settings.order, participants: s.participants, transcript: s.transcript });
    const p = s.participants[speaker];
    this.busy = true;
    this.requestAbort = new AbortController();
    const abort = this.requestAbort;
    this.emit('turn-start', { speaker, turnNumber });

    let done = null;
    let error = null;
    let speaking = false;
    try {
      await postStream(
        '/api/turn',
        {
          participants: s.participants.map(slotOf),
          speaker,
          transcript: s.transcript.map(slimEntry),
          agenda: s.agenda,
          settings: s.settings,
          turn: { number: turnNumber, total: s.totalTurns },
        },
        {
          signal: abort.signal,
          onEvent: (event, data) => {
            if (event === 'delta') {
              if (!speaking) {
                speaking = true;
                this.emit('speaking', { speaker });
              }
              this.emit('delta', { speaker, text: data.text });
            } else if (event === 'done') {
              done = data;
            } else if (event === 'error') {
              error = data;
            }
          },
        },
      );
    } catch (err) {
      if (!abort.signal.aborted) error = { message: err.message || 'Network error' };
    } finally {
      this.busy = false;
      this.requestAbort = null;
    }

    if (this.stopRequested) return null;
    if (error || !done) {
      this.emit('turn-error', { speaker, message: (error && error.message) || 'The turn ended without a reply.' });
      return null;
    }
    const entry = {
      speaker,
      text: done.refused ? '' : done.text,
      cue: done.cue,
      model: p.model,
      servedBy: done.servedBy || p.model,
      turn: turnNumber,
      at: new Date().toISOString(),
    };
    if (done.refused) entry.refused = true;
    if (done.fellBack) entry.fellBack = true;
    if (done.usage) entry.usage = done.usage;
    s.transcript.push(entry);
    this.emit('turn-end', { entry, refusalCategory: done.refusalCategory });
    this.save();
    return entry;
  }

  async replay(session) {
    await this.halt();
    this.session = session;
    this.resetFlags();
    this.setState('replaying');
    this.loopAbort = new AbortController();
    const signal = this.loopAbort.signal;
    const run = async () => {
      try {
        for (const entry of session.transcript) {
          if (this.stopRequested) break;
          this.emit(entry.speaker === MODERATOR ? 'replay-moderator' : 'replay-entry', { entry });
          await this.awaitReadiness(entry, signal);
        }
      } finally {
        this.resetFlags();
        this.loopPromise = null;
        this.setState('finished');
        this.emit('finished', { session: this.session, replay: true });
      }
    };
    this.loopPromise = run();
    return this.loopPromise;
  }
}
