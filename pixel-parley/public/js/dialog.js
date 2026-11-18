// The RPG-style dialog box: speaker name, animated portrait, typewriter text.
// Text arrives in streamed chunks; the typewriter reveals it at a steady speed.

import { drawPortrait } from './sprites.js';

export class Dialog {
  constructor(els, { onTalking = () => {}, onBlip = () => {} } = {}) {
    this.els = els;
    this.onTalking = onTalking;
    this.onBlip = onBlip;
    this.cps = 50;
    this.full = '';
    this.shown = 0;
    this.streamDone = true;
    this.waiters = [];
    this.timer = null;
    this.look = null;
    this.mouthOpen = false;
    this.blipCounter = 0;
    this.lastTick = 0;
  }

  setSpeed(cps) {
    this.cps = cps;
  }

  setReady(ready) {
    this.els.next.classList.toggle('ready', ready);
  }

  begin({ name, color, look, meta = '', slot = 0 }) {
    this.stopTicker();
    this.full = '';
    this.shown = 0;
    this.streamDone = false;
    this.slot = slot;
    this.look = look;
    this.els.name.textContent = name;
    this.els.name.style.color = color || '';
    this.els.meta.textContent = meta;
    this.els.text.textContent = '';
    this.els.text.classList.remove('error');
    this.els.text.classList.add('thinking');
    this.setReady(false);
    this.paintPortrait(false);
  }

  push(delta) {
    if (!delta) return;
    this.els.text.classList.remove('thinking');
    this.full += delta;
    this.startTicker();
  }

  // The stream is complete. `finalText` replaces the streamed text if the server
  // cleaned it up (for example, trimmed a stray name label).
  end(finalText, meta) {
    if (meta != null) this.els.meta.textContent = meta;
    if (typeof finalText === 'string' && finalText !== this.full) {
      const keep = finalText.startsWith(this.full.slice(0, this.shown)) ? this.shown : 0;
      this.full = finalText;
      this.shown = Math.min(keep, finalText.length);
    }
    this.streamDone = true;
    this.els.text.classList.remove('thinking');
    this.startTicker();
  }

  // Show a finished message immediately (used for notices, errors and replays).
  show({ name, color = '', text, meta = '', look = null, error = false }) {
    this.stopTicker();
    this.look = look;
    this.full = text;
    this.shown = text.length;
    this.streamDone = true;
    this.els.name.textContent = name;
    this.els.name.style.color = color;
    this.els.meta.textContent = meta;
    this.els.text.classList.remove('thinking');
    this.els.text.classList.toggle('error', error);
    this.render();
    this.paintPortrait(false);
    this.resolveIfDone();
  }

  skip() {
    if (this.shown < this.full.length) {
      this.shown = this.full.length;
      this.render();
    }
    this.resolveIfDone();
  }

  isRevealing() {
    return !this.streamDone || this.shown < this.full.length;
  }

  waitRevealed(signal) {
    if (!this.isRevealing()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        signal?.removeEventListener('abort', done);
        resolve();
      };
      this.waiters.push(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  // ------------------------------------------------------------ internals

  startTicker() {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 30);
  }

  stopTicker() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onTalking(false);
  }

  tick() {
    const now = performance.now();
    const dt = now - this.lastTick;
    if (this.shown < this.full.length) {
      const backlog = this.full.length - this.shown;
      // speed up a little when lots of text is waiting
      const cps = this.cps * (backlog > 220 ? 2 : 1);
      const step = Math.max(1, Math.round((cps * dt) / 1000));
      const before = this.shown;
      this.shown = Math.min(this.full.length, this.shown + step);
      this.lastTick = now;
      for (let i = before; i < this.shown; i++) {
        if (/\S/.test(this.full[i]) && ++this.blipCounter % 3 === 0) this.onBlip(this.slot);
      }
      this.render();
      this.onTalking(true);
      const open = Math.floor(now / 110) % 2 === 0;
      if (open !== this.mouthOpen) this.paintPortrait(open);
    } else {
      this.lastTick = now;
      this.onTalking(false);
      if (this.mouthOpen) this.paintPortrait(false);
      if (this.streamDone) {
        this.stopTicker();
        this.resolveIfDone();
      }
    }
  }

  render() {
    const el = this.els.text;
    el.textContent = this.full.slice(0, this.shown);
    el.scrollTop = el.scrollHeight;
  }

  resolveIfDone() {
    if (this.isRevealing()) return;
    this.setReady(true);
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  paintPortrait(mouth) {
    this.mouthOpen = mouth;
    const canvas = this.els.portrait;
    if (!this.look) {
      drawEmblem(canvas);
      return;
    }
    drawPortrait(canvas, this.look, { mouth });
  }
}

// The game's hourglass emblem, shown when no character is speaking.
const EMBLEM = [
  '.gggggggggg.',
  '..gyyyyyyg..',
  '..g.yyyy.g..',
  '...g.yy.g...',
  '....g..g....',
  '.....gg.....',
  '.....gg.....',
  '....g..g....',
  '...g.yy.g...',
  '..g.yyyy.g..',
  '..gyyyyyyg..',
  '.gggggggggg.',
];

function drawEmblem(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = Math.floor(canvas.width / 16);
  const off = Math.floor((canvas.width - EMBLEM[0].length * scale) / 2);
  const colors = { g: '#d9b05a', y: '#f2d98a' };
  EMBLEM.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(off + x * scale, off + y * scale, scale, scale);
    }
  });
}
