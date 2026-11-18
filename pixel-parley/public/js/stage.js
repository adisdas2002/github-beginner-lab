// The pixel-art stage: a torch-lit hall with the cast standing in an arc.
// Rendered at 320x180 and scaled up by CSS with crisp pixels.

import { SpriteCache, lookForParticipant } from './sprites.js';
import { drawText, drawLabel, measureText } from './pixelfont.js';

export const STAGE_W = 320;
export const STAGE_H = 180;
export const SLOT_COLORS = ['#ff8a8a', '#5fe0d2', '#ffd166', '#b9a3ff', '#86e08f', '#ffab66'];

const SPRITE_X = 26; // body centre inside the sprite canvas
const SPRITE_FEET = 33; // feet row inside the sprite canvas

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function dither(x, y, t) {
  return t * 16 > BAYER[y & 3][x & 3];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ------------------------------------------------------------------ scenery

function drawPillar(g, x) {
  g.fillStyle = '#3d325c';
  g.fillRect(x, 0, 14, 99);
  g.fillStyle = '#54477d';
  g.fillRect(x + 2, 8, 2, 84);
  g.fillStyle = '#2a223f';
  g.fillRect(x + 11, 8, 2, 84);
  g.fillStyle = '#4a3e6e';
  g.fillRect(x - 1, 0, 16, 7);
  g.fillRect(x - 1, 91, 16, 8);
  g.fillStyle = '#5d5088';
  g.fillRect(x - 1, 6, 16, 1);
  g.fillRect(x - 1, 91, 16, 1);
}

function windowHalfWidth(row, r, w) {
  if (row >= r) return w / 2;
  const dy = r - row - 0.5;
  return Math.sqrt(Math.max(0, r * r - dy * dy));
}

function drawWindow(g, x, y) {
  const w = 40;
  const h = 50;
  const r = 20;
  // stone frame: the window shape grown by 3px on every side
  g.fillStyle = '#4e4276';
  for (let row = -3; row < h + 1; row++) {
    const half = windowHalfWidth(row + 3, r + 3, w + 6);
    const cx = x + w / 2;
    g.fillRect(Math.round(cx - half), y + row, Math.round(half * 2), 1);
  }
  // night sky with dithered gradient
  for (let row = 0; row < h; row++) {
    const half = windowHalfWidth(row, r, w);
    const x0 = Math.round(x + w / 2 - half);
    const x1 = Math.round(x + w / 2 + half);
    const t = row / h;
    for (let px = x0; px < x1; px++) {
      g.fillStyle = dither(px, y + row, t) ? '#232870' : '#0d1133';
      g.fillRect(px, y + row, 1, 1);
    }
  }
  // mullions
  g.fillStyle = '#4e4276';
  g.fillRect(x + 19, y + 2, 2, h - 2);
  g.fillRect(x, y + 28, w, 2);
  // sill
  g.fillStyle = '#62568f';
  g.fillRect(x - 4, y + h, w + 8, 3);
  g.fillStyle = '#2b2346';
  g.fillRect(x - 4, y + h + 3, w + 8, 1);
}

function drawMoon(g, x, y) {
  g.fillStyle = '#f6eec8';
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dy * dy <= 25 && (dx - 3) * (dx - 3) + (dy + 1) * (dy + 1) > 18) g.fillRect(x + dx, y + dy, 1, 1);
    }
  }
}

function drawBanner(g, x, y) {
  // rod
  g.fillStyle = '#5a3a1e';
  g.fillRect(x - 6, y, 40, 2);
  g.fillStyle = '#d9b05a';
  g.fillRect(x - 8, y - 1, 3, 4);
  g.fillRect(x + 33, y - 1, 3, 4);
  // cloth with a swallowtail notch at the bottom
  g.fillStyle = '#8b2c3e';
  for (let row = 2; row < 54; row++) {
    if (row < 46) {
      g.fillRect(x, y + row, 28, 1);
      continue;
    }
    const k = row - 45; // notch half-width grows 1..8
    g.fillRect(x, y + row, 14 - k, 1);
    g.fillRect(x + 14 + k, y + row, 14 - k, 1);
  }
  g.fillStyle = '#d9b05a';
  g.fillRect(x + 2, y + 4, 24, 1);
  g.fillRect(x + 2, y + 44, 24, 1);
  g.fillRect(x + 2, y + 4, 1, 41);
  g.fillRect(x + 25, y + 4, 1, 41);
  // hourglass emblem
  const ex = x + 14;
  const ey = y + 14;
  g.fillRect(ex - 5, ey, 10, 2);
  g.fillRect(ex - 5, ey + 18, 10, 2);
  for (let i = 0; i < 8; i++) {
    const half = 4 - Math.floor(i / 2);
    g.fillRect(ex - half, ey + 2 + i, 1, 1);
    g.fillRect(ex + half - 1, ey + 2 + i, 1, 1);
    g.fillRect(ex - half, ey + 17 - i, 1, 1);
    g.fillRect(ex + half - 1, ey + 17 - i, 1, 1);
  }
  g.fillStyle = '#f2d98a';
  g.fillRect(ex - 2, ey + 4, 4, 2);
  g.fillRect(ex - 1, ey + 6, 2, 3);
  g.fillRect(ex - 3, ey + 14, 6, 2);
}

function drawRug(g, cx, cy, rx, ry) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const d = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
      if (d > 1) continue;
      let color;
      if (d > 0.965) color = '#c9a44a';
      else if (d > 0.9) color = '#5e1f2d';
      else if (d > 0.875) color = '#b08a3a';
      else color = (x + y * 2) % 12 === 0 && (y % 4 === 0) ? '#9a3a4c' : '#7a2a3b';
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
}

function renderBackground() {
  const c = makeCanvas(STAGE_W, STAGE_H);
  const g = c.getContext('2d');
  // wall
  g.fillStyle = '#2b2244';
  g.fillRect(0, 0, STAGE_W, 99);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < STAGE_W; x++) {
      if (!dither(x, y, y / 14)) {
        g.fillStyle = '#1d1731';
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  g.fillStyle = '#231b39';
  for (let row = 0; row < 13; row++) {
    const y = row * 8 + 3;
    g.fillRect(0, y + 7, STAGE_W, 1);
    const off = (row % 2) * 9;
    for (let x = -off; x < STAGE_W; x += 18) g.fillRect(x, y, 1, 7);
  }
  drawWindow(g, 42, 14);
  drawWindow(g, 238, 14);
  drawMoon(g, 70, 26);
  drawBanner(g, 146, 6);
  // baseboard
  g.fillStyle = '#17112a';
  g.fillRect(0, 96, STAGE_W, 3);
  g.fillStyle = '#463b6a';
  g.fillRect(0, 95, STAGE_W, 1);
  // floor tiles
  for (let y = 99; y < STAGE_H; y++) {
    const row = Math.floor((y - 99) / 9);
    for (let x = 0; x < STAGE_W; x++) {
      const col = Math.floor((x + (row % 2) * 10) / 20);
      g.fillStyle = (row + col) % 2 ? '#3a2f52' : '#332947';
      if ((y - 99) % 9 === 8 || (x + (row % 2) * 10) % 20 === 19) g.fillStyle = '#2a2140';
      g.fillRect(x, y, 1, 1);
    }
  }
  drawRug(g, 160, 141, 138, 30);
  drawPillar(g, 0);
  drawPillar(g, 306);
  return c;
}

function makeStars() {
  const stars = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const wx of [42, 238]) {
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(rand() * 44) + 2;
      const half = windowHalfWidth(row, 20, 40) - 2;
      if (half <= 1) continue;
      const x = Math.round(wx + 20 + (rand() * 2 - 1) * half);
      if (Math.abs(x - (wx + 20)) < 2 || Math.abs(row - 28) < 2) continue;
      if (wx === 42 && Math.hypot(x - 70, 14 + row - 26) < 8) continue;
      stars.push({ x, y: 14 + row, phase: rand() * 4000, big: rand() > 0.7 });
    }
  }
  return stars;
}

const TORCHES = [
  { x: 112, y: 40 },
  { x: 208, y: 40 },
];

const FLAMES = [
  ['..y..', '.yoy.', '.ooo.', 'orrro', '.rrr.'],
  ['.y...', '.oy..', '.ooo.', 'orror', '.rrr.'],
  ['...y.', '..yo.', '.ooo.', 'orrro', '.rrr.'],
];
const FLAME_COLORS = { y: '#fff3b0', o: '#ffb43c', r: '#e2512a' };

// ------------------------------------------------------------------ stage

function layout(n) {
  const spreads = [0, 0, 124, 172, 212, 240, 258];
  const spread = spreads[n] || 258;
  const left = 160 - spread / 2;
  return Array.from({ length: n }, (_, i) => {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const depth = 1 - (2 * u - 1) ** 2;
    return { x: Math.round(left + u * spread), feet: Math.round(146 - depth * 18) };
  });
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.background = renderBackground();
    this.stars = makeStars();
    this.cast = [];
    this.active = -1;
    this.mode = null; // 'thinking' | 'speaking'
    this.talking = false;
    this.progress = 0;
    this.running = false;
    this.status = 'ready';
    this.t0 = performance.now();
  }

  setCast(participants) {
    const spots = layout(participants.length);
    const now = performance.now() - this.t0;
    this.cast = participants.map((p, i) => {
      const look = lookForParticipant(p);
      const cache = new SpriteCache(look);
      return {
        p,
        look,
        cache,
        x: spots[i].x,
        feet: spots[i].feet,
        color: SLOT_COLORS[i % SLOT_COLORS.length],
        short: p.short,
        phase: i * 170,
        artMs: look.artifact === 'orrery' ? 140 : look.artifact === 'charkha' ? 110 : 160,
        nextBlink: now + 800 + Math.random() * 3000,
        blinkUntil: 0,
      };
    });
    if (this.active >= this.cast.length) this.active = -1;
  }

  setActive(index, mode) {
    this.active = index;
    this.mode = mode;
    if (mode !== 'speaking') this.talking = false;
  }

  setTalking(on) {
    this.talking = on;
  }

  setProgress(done, total) {
    this.progress = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  }

  setStatus(status) {
    this.status = status;
    this.running = status === 'running' || status === 'replaying';
  }

  start() {
    let reported = false;
    const loop = (now) => {
      try {
        this.draw(now);
      } catch (err) {
        if (!reported) console.error('Stage drawing failed:', err);
        reported = true;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // Which cast member is under a page coordinate? Returns { index, rect } or null.
  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * STAGE_W;
    const y = ((clientY - rect.top) / rect.height) * STAGE_H;
    for (let i = this.cast.length - 1; i >= 0; i--) {
      const c = this.cast[i];
      if (x >= c.x - 14 && x <= c.x + 14 && y >= c.feet - 34 && y <= c.feet + 13) return i;
    }
    return -1;
  }

  // Position (in CSS pixels, relative to the canvas) just above a character's head.
  anchorFor(index) {
    const c = this.cast[index];
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.width / STAGE_W;
    return { x: c.x * scale, y: (c.feet - 36) * scale };
  }

  draw(now) {
    // rAF timestamps can be slightly older than t0, so never let time go negative
    const t = Math.max(0, now - this.t0);
    const g = this.ctx;
    g.drawImage(this.background, 0, 0);
    this.drawAmbience(g, t);

    const order = this.cast.map((_, i) => i).sort((a, b) => this.cast[a].feet - this.cast[b].feet);
    if (this.active >= 0 && this.cast[this.active]) this.drawSpotlight(g, this.cast[this.active], t);
    for (const i of order) this.drawCharacter(g, i, t);
    this.drawHourglass(g, t);
    for (const i of order) this.drawNameplate(g, i);
    if (this.active >= 0 && this.cast[this.active]) this.drawIndicator(g, this.cast[this.active], t);
    this.drawStatus(g, t);
  }

  drawAmbience(g, t) {
    for (const s of this.stars) {
      const tw = Math.sin((t + s.phase) / 600) > 0.3;
      g.fillStyle = tw ? '#ffffff' : '#9aa4e6';
      g.fillRect(s.x, s.y, 1, 1);
      if (s.big && tw) {
        g.fillStyle = 'rgba(200,210,255,0.6)';
        g.fillRect(s.x - 1, s.y, 1, 1);
        g.fillRect(s.x + 1, s.y, 1, 1);
        g.fillRect(s.x, s.y - 1, 1, 1);
        g.fillRect(s.x, s.y + 1, 1, 1);
      }
    }
    for (const [k, torch] of TORCHES.entries()) {
      const frame = Math.floor((t + k * 90) / 130) % FLAMES.length;
      const flicker = Math.sin((t + k * 300) / 170) * 1.5;
      // glow
      for (const [r, a] of [
        [22 + flicker, 0.05],
        [14 + flicker, 0.07],
        [8, 0.08],
      ]) {
        g.fillStyle = `rgba(255,170,80,${a})`;
        g.beginPath();
        g.arc(torch.x, torch.y - 2, r, 0, Math.PI * 2);
        g.fill();
      }
      // sconce
      g.fillStyle = '#1a1424';
      g.fillRect(torch.x - 3, torch.y + 3, 6, 2);
      g.fillRect(torch.x - 1, torch.y + 5, 2, 5);
      g.fillStyle = '#5a4630';
      g.fillRect(torch.x - 2, torch.y + 1, 4, 2);
      // flame
      FLAMES[frame].forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const key = row[rx];
          if (key === '.') continue;
          g.fillStyle = FLAME_COLORS[key];
          g.fillRect(torch.x - 2 + rx, torch.y - 4 + ry, 1, 1);
        }
      });
    }
  }

  drawSpotlight(g, c, t) {
    const pulse = 0.16 + Math.sin(t / 400) * 0.03;
    g.fillStyle = `rgba(255,236,170,${pulse * 0.35})`;
    g.beginPath();
    g.moveTo(c.x - 7, 0);
    g.lineTo(c.x + 7, 0);
    g.lineTo(c.x + 17, c.feet);
    g.lineTo(c.x - 17, c.feet);
    g.closePath();
    g.fill();
    g.fillStyle = `rgba(255,236,170,${pulse})`;
    for (let dy = -3; dy <= 3; dy++) {
      const half = Math.round(17 * Math.sqrt(1 - (dy / 4) ** 2));
      g.fillRect(c.x - half, c.feet + dy, half * 2, 1);
    }
  }

  drawCharacter(g, i, t) {
    const c = this.cast[i];
    const isActive = i === this.active;
    const talking = isActive && this.talking;
    const period = talking ? 170 : isActive && this.mode === 'thinking' ? 420 : 640;
    const bob = Math.floor((t + c.phase) / period) % 2;
    if (t > c.nextBlink) {
      c.blinkUntil = t + 140;
      c.nextBlink = t + 2200 + Math.random() * 3600;
    }
    const blink = t < c.blinkUntil;
    const mouth = talking && Math.floor(t / 110) % 2 === 0;
    const art = Math.floor(t / c.artMs);
    // shadow
    g.fillStyle = 'rgba(6,3,14,0.45)';
    g.fillRect(c.x - 8, c.feet + 1, 16, 1);
    g.fillRect(c.x - 6, c.feet + 2, 12, 1);
    const sprite = c.cache.get({ blink, mouth, art, talking: isActive && this.mode === 'speaking' });
    g.drawImage(sprite, c.x - SPRITE_X, c.feet - SPRITE_FEET - bob);
  }

  drawNameplate(g, i) {
    const c = this.cast[i];
    const isActive = i === this.active;
    const w = measureText(c.short);
    const bx = Math.round(c.x - w / 2) - 3;
    const by = c.feet + 5;
    g.fillStyle = '#0b0816';
    g.fillRect(bx - 1, by - 1, w + 8, 11);
    g.fillStyle = isActive ? c.color : '#1b1638';
    g.fillRect(bx, by, w + 6, 9);
    drawText(g, c.short, bx + 3, by + 2, isActive ? '#0b0816' : c.color);
  }

  drawIndicator(g, c, t) {
    const top = c.feet - 47;
    if (this.mode === 'thinking') {
      const x = c.x + 3;
      g.fillStyle = '#0b0816';
      g.fillRect(x - 1, top - 1, 19, 11);
      g.fillRect(x - 2, top + 1, 21, 7);
      g.fillStyle = '#f4f1ea';
      g.fillRect(x, top, 17, 9);
      g.fillRect(x - 1, top + 2, 19, 5);
      g.fillRect(x - 1, top + 11, 3, 2);
      g.fillRect(x - 3, top + 14, 2, 2);
      const dots = Math.floor(t / 320) % 4;
      g.fillStyle = '#2b2244';
      for (let d = 0; d < dots; d++) g.fillRect(x + 3 + d * 5, top + 4, 2, 2);
    } else if (this.mode === 'speaking') {
      const y = top + 6 + (Math.floor(t / 260) % 2);
      g.fillStyle = '#0b0816';
      g.fillRect(c.x - 4, y - 1, 9, 5);
      g.fillStyle = c.color;
      g.fillRect(c.x - 3, y, 7, 1);
      g.fillRect(c.x - 2, y + 1, 5, 1);
      g.fillRect(c.x - 1, y + 2, 3, 1);
      g.fillRect(c.x, y + 3, 1, 1);
    }
  }

  drawHourglass(g, t) {
    const cx = 160;
    const top = 151;
    // frame
    g.fillStyle = '#0b0816';
    g.fillRect(cx - 9, top - 1, 18, 4);
    g.fillRect(cx - 9, top + 23, 18, 4);
    g.fillStyle = '#9a6232';
    g.fillRect(cx - 8, top, 16, 2);
    g.fillRect(cx - 8, top + 24, 16, 2);
    g.fillStyle = '#c8894a';
    g.fillRect(cx - 8, top, 16, 1);
    g.fillRect(cx - 8, top + 24, 16, 1);
    g.fillStyle = '#5a3418';
    g.fillRect(cx - 7, top + 2, 1, 22);
    g.fillRect(cx + 6, top + 2, 1, 22);
    // glass and sand
    const topSand = Math.round((1 - this.progress) * 10);
    const bottomSand = Math.round(this.progress * 10);
    for (let i = 0; i < 10; i++) {
      const half = 5 - Math.floor(i / 2);
      const yTop = top + 2 + i;
      const yBottom = top + 23 - i;
      g.fillStyle = 'rgba(200,232,255,0.22)';
      g.fillRect(cx - half, yTop, half * 2, 1);
      g.fillRect(cx - half, yBottom, half * 2, 1);
      g.fillStyle = '#cfe9ff';
      g.fillRect(cx - half - 1, yTop, 1, 1);
      g.fillRect(cx + half, yTop, 1, 1);
      g.fillRect(cx - half - 1, yBottom, 1, 1);
      g.fillRect(cx + half, yBottom, 1, 1);
      g.fillStyle = '#f2c45a';
      if (9 - i < topSand) g.fillRect(cx - half, yTop, half * 2, 1);
      if (i < bottomSand) g.fillRect(cx - half, yBottom, half * 2, 1);
    }
    g.fillStyle = '#cfe9ff';
    g.fillRect(cx - 1, top + 12, 2, 1);
    if (this.running && this.progress > 0 && this.progress < 1) {
      g.fillStyle = '#f2c45a';
      for (let y = top + 12; y < top + 23 - bottomSand; y++) {
        if ((y + Math.floor(t / 90)) % 3 !== 0) g.fillRect(cx, y, 1, 1);
      }
    }
  }

  drawStatus(g, t) {
    const blinkOn = Math.floor(t / 600) % 2 === 0;
    let text = '';
    if (this.status === 'ready' && blinkOn) text = 'PRESS START';
    else if (this.status === 'paused' && blinkOn) text = 'PAUSED';
    else if (this.status === 'finished') text = 'THE END';
    else if (this.status === 'replaying') text = 'REPLAY';
    if (text) {
      const w = measureText(text);
      g.fillStyle = 'rgba(11,8,22,0.75)';
      g.fillRect(Math.round(160 - w / 2) - 4, 63, w + 8, 10);
      drawLabel(g, text, 160, 65, '#ffe08a');
    }
  }
}
