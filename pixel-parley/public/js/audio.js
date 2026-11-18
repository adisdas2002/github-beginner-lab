// Retro text "blips" made with the Web Audio API (no audio files). Each seat
// has its own pitch so voices sound different. Off by default.

const PITCHES = [392, 523, 330, 466, 294, 587];

let ctx = null;
let enabled = false;

export function setSoundEnabled(on) {
  enabled = on;
  if (on && !ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      enabled = false;
    }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return enabled;
}

export function isSoundEnabled() {
  return enabled;
}

function tone(freq, start, length, volume = 0.03, type = 'square') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export function blip(slot = 0) {
  if (!enabled || !ctx) return;
  const base = PITCHES[slot % PITCHES.length];
  tone(base * (0.96 + Math.random() * 0.08), ctx.currentTime, 0.045);
}

export function jingle() {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.09, 0.12, 0.04));
}
