// Layered pixel-art sprite builder.
//
// A character is composed on a 24x32 "body grid" from named parts (head, hair,
// facial hair, eyewear, outfit, extras), then given an automatic dark outline.
// Part maps are strings of palette keys; '.' is transparent. Maps marked `sym`
// are written as 12-character left halves and mirrored, which keeps faces and
// outfits perfectly symmetric.
//
// The sprite canvas is wider than the body (CW x CH) so artifacts can sit beside
// the figure. Everything here is pure data + math; only `gridToCanvas` and
// `SpriteCache` touch the DOM, so the builder also runs (and is tested) in Node.

import { getFigure } from '../../shared/figures.js';
import { modelFamily } from '../../shared/models.js';
import { ARTIFACT_PALETTE, getArtifact } from './artifacts.js';

export const BODY_W = 24;
export const BODY_H = 32;
export const OX = 14; // body origin inside the sprite canvas
export const OY = 2;
export const CW = BODY_W + OX * 2; // 52
export const CH = BODY_H + OY; // 34

// ---------------------------------------------------------------------------
// Palette helpers

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  return rgbToHex([r + (t - r) * k, g + (t - g) * k, b + (t - b) * k]);
}

const BASE_PALETTE = {
  o: '#140c1c', // outline
  e: '#1b1220', // eyes
  m: '#5c1f2a', // open mouth
  k: '#24202e', K: '#4a4458',
  q: '#3a3342', j: '#c9cdd6', J: '#8d93a3',
  w: '#f4f1ea', y: '#f2c94c', Y: '#c99a2e',
  r: '#c8323c', R: '#8e1f2a',
  g: '#e0b545', G: '#a87a24',
  l: '#4f9a3a', L: '#2f6b25',
  u: '#5fa8e8', t: '#2fae8f', v: '#1d1838', n: '#ffd75e',
  a: '#8a2a2a', A: '#5e1c1c',
  c: '#6a5a8a', C: '#4a3d66',
  d: '#f2efe6', D: '#cfc8b8',
  p: '#3c3a46', P: '#2a2832',
  b: '#7a4a24', B: '#5a3418',
  s: '#e8c09a', S: '#c99e78',
  h: '#3b2a20', H: '#5a4232',
};

function completePalette(p) {
  const pal = { ...BASE_PALETTE, ...p };
  if (!p.b) pal.b = pal.h; // brows follow the hair unless set
  if (!p.f) pal.f = pal.h; // facial hair too
  if (!p.F) pal.F = p.H || shade(pal.f, -0.2);
  if (!p.X) pal.X = shade(pal.s, 0.18); // skin highlight
  return pal;
}

// ---------------------------------------------------------------------------
// Grid

export class Grid {
  constructor() {
    this.px = new Array(CW * CH).fill(null);
  }
  index(x, y) {
    const cx = x + OX;
    const cy = y + OY;
    if (cx < 0 || cy < 0 || cx >= CW || cy >= CH) return -1;
    return cy * CW + cx;
  }
  get(x, y) {
    const i = this.index(x, y);
    return i < 0 ? null : this.px[i];
  }
  set(x, y, color) {
    const i = this.index(x, y);
    if (i >= 0) this.px[i] = color;
  }
}

function expandRow(row, sym) {
  if (!sym) return row;
  return row + [...row].reverse().join('');
}

// Stamp a map. `rows` is an array of strings; `y0` the first row's body y.
function stamp(grid, part, pal, { under = false } = {}) {
  const { rows, y0 = 0, x0 = 0, sym = false } = part;
  rows.forEach((raw, r) => {
    const row = expandRow(raw, sym);
    for (let c = 0; c < row.length; c++) {
      const key = row[c];
      if (key === '.' || key === ' ') continue;
      const color = pal[key];
      if (!color) continue;
      const x = x0 + c;
      const y = y0 + r;
      if (under && grid.get(x, y)) continue;
      grid.set(x, y, color);
    }
  });
}

function outline(grid, color) {
  const marks = [];
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const i = cy * CW + cx;
      if (grid.px[i]) continue;
      const n =
        (cx > 0 && grid.px[i - 1]) ||
        (cx < CW - 1 && grid.px[i + 1]) ||
        (cy > 0 && grid.px[i - CW]) ||
        (cy < CH - 1 && grid.px[i + CW]);
      if (n) marks.push(i);
    }
  }
  for (const i of marks) grid.px[i] = color;
}

// ---------------------------------------------------------------------------
// Part library

const HEAD = {
  sym: true,
  y0: 5,
  rows: [
    '........ssss',
    '.......sssss',
    '......ssssss',
    '......ssssss',
    '......ssssss',
    '.....sssssss',
    '.....Sssssss',
    '......ssssss',
    '.......sssss',
    '........Ssss',
    '..........SS',
  ],
};

export const HAIR = {
  short: {
    front: { sym: true, y0: 4, rows: ['........hhhh', '.......hhhhh', '......hhhhhh', '......hh....', '......h.....'] },
  },
  bald: {
    front: {
      y0: 6,
      rows: [
        '.........XX.............',
        '........X...............',
        '......h..........h......',
        '......h..........h......',
      ],
    },
  },
  sidepart: {
    front: {
      y0: 4,
      rows: [
        '........hhhhhhhh........',
        '.......hhhhhhHhhh.......',
        '......hhhhhhhhh.hh......',
        '......hhhhhhhH...h......',
        '......hhhhh......h......',
        '......hh................',
      ],
    },
  },
  swoop: {
    front: {
      y0: 3,
      rows: [
        '.........HHhhhh.........',
        '.......hhHHhhhhhhh......',
        '......hhhhHHhhhhhhh.....',
        '.....hhhhhhhHHhhhhhh....',
        '.....hhhhh......hhhh....',
        '.....hh..........hh.....',
        '......h..........h......',
      ],
    },
  },
  long: {
    back: {
      sym: true,
      y0: 8,
      rows: [
        '.....h......',
        '....hh......',
        '....hh......',
        '....hh......',
        '....hhh.....',
        '....hhh.....',
        '....hhh.....',
        '....hhh.....',
        '....hh......',
        '....hh......',
        '....hh......',
        '.....h......',
      ],
    },
    front: {
      sym: true,
      y0: 4,
      rows: [
        '........hhhh',
        '.......hhhhh',
        '......hhhhh.',
        '......hhhh..',
        '......hhh...',
        '......hh....',
        '......hh....',
        '......hh....',
        '......hh....',
        '.......h....',
      ],
    },
  },
  buddha: {
    front: {
      sym: true,
      y0: 1,
      rows: ['..........hh', '.........hHh', '........hhhh', '.......hHhhH', '......hhhhhh', '......hHhhHh', '......hh....'],
    },
  },
  krishna: {
    back: {
      sym: true,
      y0: 7,
      rows: ['.....h......', '....hh......', '....hH......', '....hh......', '....Hh......', '....hh......', '....hH......', '....hh......', '.....h......'],
    },
    front: { sym: true, y0: 6, rows: ['......hhhhhh', '......hh....', '......h.....', '......h.....'] },
  },
  scholar: {
    front: {
      sym: true,
      y0: 1,
      rows: ['...........k', '..........kk', '........kkkk', '.......kkkkk', '......kKkkkk', '......hh....', '......h.....'],
    },
  },
  beret: {
    back: {
      sym: true,
      y0: 8,
      rows: ['.....h......', '....hh......', '....hh......', '....hh......', '....hhh.....', '....hhh.....', '....hhh.....', '....hh......', '....hh......', '.....h......'],
    },
    front: {
      y0: 2,
      rows: [
        '.......kkkkkkkkk........',
        '.....kkkkkkkkkkkkk......',
        '....kkkkkkkkkkkkkkk.....',
        '.....KKKkkkkkkkkkkkk....',
        '......hhh........hhh....',
        '......hh..........h.....',
        '......h...........h.....',
        '......h..........h......',
        '......h..........h......',
        '......h..........h......',
        '......h..........h......',
      ],
    },
  },
  bob: {
    front: {
      sym: true,
      y0: 4,
      rows: ['........hhhh', '.......hhhhh', '......hhhhhh', '......hhhhhh', '.....hh.....', '.....hh.....', '.....hh.....', '.....hh.....', '.....hh.....', '......h.....'],
    },
  },
  receding: {
    front: { sym: true, y0: 4, rows: ['.........hhh', '.......hhhhh', '......hhh...', '......hh....', '......h.....'] },
  },
  caesar: {
    front: { sym: true, y0: 4, rows: ['........hhhh', '.......hhhhh', '......hhhhhh', '......h.h.h.'] },
  },
  wild: {
    front: {
      y0: 1,
      rows: [
        '.......h...h..h...h.....',
        '.....hh.hhhhhhhhh.hh....',
        '....hhhhhHhhhhhHhhhhh...',
        '...hhhhHhhhhhhhhhhHhhh..',
        '...hhhhh........hhhhhh..',
        '..hhhhhh........hhhhhhh.',
        '..hhhhh..........hhhhh..',
        '...hhhh..........hhhh...',
        '...hh..............hh...',
        '....h..............h....',
      ],
    },
  },
};

export const FACIAL = {
  mustache: { sym: true, y0: 12, rows: ['..........ff'] },
  toothbrush: { sym: true, y0: 12, rows: ['...........f'] },
  goatee: { sym: true, y0: 12, rows: ['..........ff', '............', '...........f'] },
  bushy: { sym: true, y0: 12, rows: ['.........fff', '.........f..'] },
  beard: { sym: true, y0: 12, rows: ['......ff.fff', '.......ffff.', '........ffff', '.........fff', '..........ff'] },
  longBeard: {
    sym: true,
    y0: 11,
    rows: ['......f.....', '......ff.fff', '.......ffff.', '.......fffff', '.......fFfff', '........ffff', '........fFff', '.........fff', '..........ff', '...........f'],
  },
  sageBeard: {
    sym: true,
    y0: 12,
    rows: ['.......f.fff', '.......f....', '.........fff', '.........fFf', '..........ff', '..........ff', '...........f'],
  },
};

export const EYEWEAR = {
  round: { sym: true, y0: 9, rows: ['.........q..', '......qqq.qq', '........q.q.', '.........q..'] },
  browline: { sym: true, y0: 9, rows: ['.......qqqq.', '.......j..jj', '.......j..j.', '........jj..'] },
};

const LEGS_SUIT = ['........ppP.', '........ppP.', '........ppP.', '........ppP.', '........ppP.', '.......kkkk.', '.......kKkk.'];
const ROBE_LOWER = ['.......ccccc', '......Cccccc', '......Cccccc', '......CcccCc', '.....CccccCc', '.....CCcccCc', '........kkk.'];

export const OUTFITS = {
  suit: {
    sym: true,
    y0: 16,
    rows: [
      '......ccccdd',
      '.....cCcccda',
      '.....cCccCca',
      '.....cCcCcca',
      '.....cCccccA',
      '.....cCcccca',
      '.....cCccccA',
      '.....ssccccc',
      '.....SSCcccc',
      ...LEGS_SUIT,
    ],
  },
  robe: {
    sym: true,
    y0: 16,
    rows: [
      '......cccccc',
      '.....cCccccc',
      '.....cCccccc',
      '.....cCccccc',
      '.....cCccccc',
      '.....cCccccc',
      '.....cCccccc',
      '.....ssccccc',
      '.....SSccccc',
      ...ROBE_LOWER,
    ],
  },
  hanfu: {
    sym: true,
    y0: 16,
    rows: [
      '......cccccc',
      '.....cCccccc',
      '.....cCccccc',
      '....ccCccccc',
      '....ccCccccc',
      '....cCCccccc',
      '....cCCaaaaa',
      '....cssccccc',
      '.....SSccccc',
      ...ROBE_LOWER,
    ],
  },
  sweater: {
    sym: true,
    y0: 16,
    rows: [
      '......ccccdd',
      '.....cCcccCd',
      '.....cCcccCd',
      '.....cCcccCd',
      '.....cCcccCd',
      '.....cCcccCd',
      '.....cCcccCC',
      '.....ssccccc',
      '.....SSCcccc',
      '.......pppP.',
      '.......pppP.',
      '.......pppP.',
      '........ppP.',
      '........ppP.',
      '.......kkkk.',
      '.......kkkk.',
    ],
  },
  uniform: {
    sym: true,
    y0: 16,
    rows: [
      '......cccccc',
      '.....cCccccC',
      '.....cCCCccg',
      '.....cCccccC',
      '.....cCccccg',
      '.....cCccccC',
      '.....cCaaaag',
      '.....ssccccC',
      '.....SSccccc',
      '.......pppP.',
      '.......pppP.',
      '........kkK.',
      '........kkK.',
      '........kkK.',
      '.......kkkK.',
      '.......kkkk.',
    ],
  },
  armor: {
    sym: true,
    y0: 16,
    rows: [
      '......dggggg',
      '.....ddGgggg',
      '.....ddgGGgg',
      '.....ssggggG',
      '.....sSgGgGg',
      '.....sSggggG',
      '.....sSgGgGg',
      '.....ssggggg',
      '.....SSbBbBb',
      '.......bBbBb',
      '.......ddddd',
      '........ssS.',
      '........ssS.',
      '........ssS.',
      '........kkk.',
      '.......kkkk.',
    ],
  },
  krishna: {
    sym: true,
    y0: 16,
    rows: [
      '......ssssss',
      '.....sSsssss',
      '.....sSsssss',
      '.....gGsssss',
      '.....sSsssss',
      '.....sSsssss',
      '.....sSaaaaa',
      '.....ssccccc',
      '.....SSccccC',
      '.......ccccC',
      '.......ccccC',
      '.......cccC.',
      '.......cccC.',
      '.......cccC.',
      '........ggg.',
      '........sss.',
    ],
  },
  monk: {
    y0: 16,
    rows: [
      '......sssssccccccc......',
      '.....ssssssCccccccc.....',
      '.....sSsssCccccccCc.....',
      '.....sSssCcccccccCc.....',
      '.....sSsCccccccccCc.....',
      '.....sSCcccccccccCc.....',
      '.....sSccccccccccCc.....',
      '.....ssccccccccccss.....',
      '.....SSccccCcccccSS.....',
      '.......ccccCccccc.......',
      '......cccccCcccccc......',
      '......CccccCcccccc......',
      '......cCcccCccccCc......',
      '.....cccCccCcccCccc.....',
      '.....CcccccCccccccC.....',
      '........ss....ss........',
    ],
  },
  shawl: {
    y0: 16,
    rows: [
      '......cccccccccccc......',
      '.....cCccccccccccCc.....',
      '.....cCCcccccccccCc.....',
      '.....ssCCccccccccCc.....',
      '.....sSccCCccccccCc.....',
      '.....sSccccCCccccCc.....',
      '.....sSccccccCCccCc.....',
      '.....ssccccccccCCss.....',
      '.....SScccccccccCSS.....',
      '.......ccccCCcccc.......',
      '.......ccccCCcccc.......',
      '.......cccc..cccc.......',
      '........sS....Ss........',
      '........sS....Ss........',
      '........sS....Ss........',
      '.......kkkk..kkkk.......',
    ],
  },
  bot: {
    sym: true,
    y0: 16,
    rows: [
      '.......ccccc',
      '....CC.ccccc',
      '....cc.cCCCC',
      '....kk.cCvvg',
      '....cc.cCvvg',
      '....cc.cCCCC',
      '....CC.ccccc',
      '....JJ.kkkkk',
      '.......ccccc',
      '........cCc.',
      '........cCc.',
      '........kkk.',
      '........cCc.',
      '........cCc.',
      '.......CCCC.',
      '.......CCCC.',
    ],
  },
};

const OVERLAYS = {
  mantle: {
    y0: 16,
    rows: [
      '............aaaaaa......',
      '...........aaaaaaaa.....',
      '..........aaaaAaaaa.....',
      '.........aaaaAaaaaa.....',
      '........aaaaA...aaa.....',
      '.......aaaaA.....aa.....',
      '.......aaaA......aa.....',
      '.......aaA..............',
      '.......aA...............',
    ],
  },
  belt: { sym: true, y0: 22, rows: ['.......aaaag'] },
  collar: { sym: true, y0: 16, rows: ['.........ddd', '..........dD'] },
  furCollar: { sym: true, y0: 16, rows: ['......dddddd', '.....dDdd...'] },
  strap: { y0: 16, rows: ['........A...............', '.........A..............', '..........A.............', '...........A............', '............A...........', '.............A..........'] },
  longTie: { sym: true, y0: 23, rows: ['...........a', '...........A'] },
  hanfuCollar: {
    y0: 16,
    rows: ['..........d..d..........', '...........dd...........', '...........d............', '..........d.............', '.........d..............'],
  },
  garland: { sym: true, y0: 16, rows: ['........r.gg', '........y...', '.........r..', '.........y..', '..........r.', '...........y'] },
  brooch: { y0: 16, rows: ['................y.......'] },
};

const EXTRAS = {
  earlobes: { layer: 'head', part: { sym: true, y0: 12, rows: ['.....S......', '.....S......'] } },
  crown: { layer: 'top', part: { sym: true, y0: 1, rows: ['...........g', '.......g..gg', '.......gGggg', '.......ggggr', '......GgggGg'] } },
  feather: {
    layer: 'top',
    part: {
      y0: -2,
      rows: ['..............tt........', '.............tuut.......', '.............tuut.......', '..............tt........', '...............t........'],
    },
  },
  laurel: { layer: 'top', part: { sym: true, y0: 3, rows: ['......l.....', '.....lLl....', '....lLlLl...', '.....LlL....'] } },
  cloak: {
    layer: 'back',
    part: {
      sym: true,
      y0: 16,
      rows: ['.....aa.....', '....aa......', '...aaa......', '...aaa......', '...aaa......', '...aaa......', '...aaa......', '...aAa......', '...aaa......', '...aAa......', '...aaa......', '...aAa......', '...aaA......', '...aA.......'],
    },
  },
  halo: { layer: 'halo' },
};

const BOT_HEAD = {
  sym: true,
  y0: 2,
  rows: [
    '...........g',
    '...........k',
    '........cccc',
    '.......ccccc',
    '......cCCCCC',
    '......cCvvvv',
    '......cCvvvv',
    '......cCvvvv',
    '.....kcCCCCC',
    '.....kcccccc',
    '......cccccc',
    '.......ccccc',
    '........cccc',
    '..........kk',
  ],
};

const BOT_COLORS = {
  opus: { c: '#9584f2', C: '#6352c4', g: '#ffcf5a' },
  sonnet: { c: '#5ab0f0', C: '#3a7cc2', g: '#c4fff4' },
  haiku: { c: '#6fd38a', C: '#44a062', g: '#fff3a0' },
  fable: { c: '#f0a14a', C: '#c27426', g: '#fff0c2' },
  mythos: { c: '#e0607a', C: '#b03c56', g: '#ffe0f0' },
  claude: { c: '#b8bcc8', C: '#858a9a', g: '#a8f4ff' },
};

// ---------------------------------------------------------------------------
// Looks

function hashString(s) {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(list, h, salt) {
  return list[(h >>> salt) % list.length];
}

const CUSTOM_SKIN = [
  ['#f1c9a5', '#d6a581'],
  ['#e2b68e', '#c49470'],
  ['#c68c5e', '#a8704a'],
  ['#a8704a', '#8a5636'],
  ['#7d5236', '#633f29'],
  ['#5e3d2a', '#4a2f20'],
];
const CUSTOM_HAIR = ['#1b1512', '#3b2416', '#6b4a33', '#a87a3a', '#d8c07a', '#9a9a9a', '#e8e8e8', '#7a2a1a'];
const CUSTOM_CLOTH = [
  ['#3b5fa8', '#2a447d'],
  ['#7a2433', '#55182a'],
  ['#2e6e4e', '#1f4d36'],
  ['#6b4f8a', '#4c3866'],
  ['#8a6a2a', '#66501f'],
  ['#2a2a33', '#1c1c23'],
  ['#a84a2a', '#7a341c'],
];

export function customLook(name, prop = 'quill') {
  const h = hashString(name || 'guest');
  const [s, S] = pick(CUSTOM_SKIN, h, 0);
  const hair = pick(CUSTOM_HAIR, h, 3);
  const [c, C] = pick(CUSTOM_CLOTH, h, 6);
  return {
    kind: 'human',
    palette: {
      s, S, h: hair, H: shade(hair, hair === '#e8e8e8' ? -0.15 : 0.15),
      c, C, a: shade(c, -0.45), A: shade(c, -0.6),
      d: '#f2efe6', D: '#cfc8b8', p: '#3c3a46', P: '#2a2832', k: '#24202e',
    },
    parts: {
      hair: pick(['short', 'long', 'bob', 'receding', 'bald', 'wild', 'beret', 'caesar'], h, 9),
      facial: pick([null, null, null, 'mustache', 'beard', 'goatee', 'longBeard'], h, 12),
      outfit: pick(['robe', 'suit', 'sweater', 'hanfu', 'robe'], h, 15),
    },
    artifact: prop,
  };
}

export function botLook(model) {
  const family = modelFamily(model);
  return {
    kind: 'bot',
    palette: { ...BOT_COLORS[family], v: '#1d1838', k: '#2a2440', J: '#d8dce6' },
    artifact: 'sparkle',
  };
}

export function lookForParticipant(p) {
  if (p.kind === 'preset') {
    const f = getFigure(p.presetId);
    return { kind: 'human', palette: f.look.palette, parts: f.look.parts, artifact: f.artifact.id };
  }
  if (p.kind === 'custom') return customLook(p.name, p.prop);
  return botLook(p.model);
}

// ---------------------------------------------------------------------------
// Frame building

const HALO_INNER = '#f7e3a1';
const HALO_OUTER = '#d9b860';

function drawHalo(grid) {
  const cx = 11.5;
  const cy = 7.5;
  for (let y = -2; y < 18; y++) {
    for (let x = 0; x < 24; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.08);
      if (d >= 8.2 && d < 9.2 && !grid.get(x, y)) grid.set(x, y, d < 8.7 ? HALO_INNER : HALO_OUTER);
    }
  }
}

function drawHumanFace(grid, pal, { blink, mouth }) {
  // brows
  for (const [x, y] of [[8, 9], [9, 9], [14, 9], [15, 9]]) grid.set(x, y, pal.b);
  // eyes
  if (blink) {
    for (const x of [9, 14]) grid.set(x, 11, pal.e);
  } else {
    for (const x of [9, 14]) {
      grid.set(x, 10, pal.e);
      grid.set(x, 11, pal.e);
    }
  }
  // mouth
  if (mouth) {
    for (const x of [11, 12]) {
      grid.set(x, 13, pal.m);
      grid.set(x, 14, pal.m);
    }
  } else {
    for (const x of [11, 12]) grid.set(x, 13, pal.S);
  }
}

function drawBotFace(grid, pal, { blink, mouth }) {
  const eye = blink ? pal.C : pal.g;
  for (const x of [9, 10, 13, 14]) grid.set(x, 8, eye);
  if (mouth) {
    for (const x of [10, 11, 12, 13]) grid.set(x, 12, pal.g);
  } else {
    for (const x of [11, 12]) grid.set(x, 12, pal.C);
  }
}

function artifactApi(grid, pal, artPal, { fxLayer = false, talking = false } = {}) {
  const resolve = (key) => artPal[key] || pal[key];
  return {
    talking,
    px(x, y, key) {
      const c = resolve(key);
      if (c) grid.set(x, y, c);
    },
    map(rows, x0, y0) {
      stamp(grid, { rows, x0, y0 }, new Proxy({}, { get: (_, k) => resolve(k) }));
    },
    line(x0, y0, x1, y1, key) {
      const c = resolve(key);
      let dx = Math.abs(x1 - x0);
      let dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        grid.set(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    },
    // fx helpers (used by fx layers; same as px/map but semantically "no outline")
    fx(x, y, key) {
      const c = resolve(key);
      if (c) grid.set(x, y, c);
    },
    fxMap(rows, x0, y0) {
      stamp(grid, { rows, x0, y0 }, new Proxy({}, { get: (_, k) => resolve(k) }));
    },
    fxUnder(x, y, key) {
      if (!grid.get(x, y)) {
        const c = resolve(key);
        if (c) grid.set(x, y, c);
      }
    },
    fxLayer,
  };
}

export function buildFrame(look, { blink = false, mouth = false, art = 0, talking = false } = {}) {
  const grid = new Grid();
  const pal = completePalette(look.palette || {});
  const parts = look.parts || {};
  const artifact = getArtifact(look.artifact || 'none');
  const artPal = { ...ARTIFACT_PALETTE, s: pal.s, S: pal.S };
  const frame = artifact.frames > 1 ? art % artifact.frames : 0;
  const extras = (parts.extras || []).map((id) => EXTRAS[id]).filter(Boolean);
  const api = artifactApi(grid, pal, artPal, { talking });

  if (look.kind === 'bot') {
    stamp(grid, OUTFITS.bot, pal);
    stamp(grid, BOT_HEAD, pal);
    drawBotFace(grid, pal, { blink, mouth });
  } else {
    // behind the body
    if (artifact.back) artifact.back(api, frame);
    for (const e of extras) if (e.layer === 'back') stamp(grid, e.part, pal);
    const hair = HAIR[parts.hair] || {};
    if (hair.back) stamp(grid, hair.back, pal);

    // body and head
    stamp(grid, OUTFITS[parts.outfit] || OUTFITS.robe, pal);
    for (const id of parts.overlays || []) if (OVERLAYS[id]) stamp(grid, OVERLAYS[id], pal);
    if (parts.outfit === 'uniform') stamp(grid, OVERLAYS.strap, pal);
    if (parts.outfit === 'hanfu') stamp(grid, OVERLAYS.hanfuCollar, pal);
    if (parts.outfit === 'krishna') stamp(grid, OVERLAYS.garland, pal);
    if (parts.outfit === 'armor') {
      stamp(grid, EXTRAS.cloak.part, pal, { under: true });
      stamp(grid, OVERLAYS.brooch, pal);
    }
    if (parts.variant && parts.variant.longTie) stamp(grid, OVERLAYS.longTie, pal);
    stamp(grid, HEAD, pal);
    for (const e of extras) if (e.layer === 'head') stamp(grid, e.part, pal);

    // face, facial hair, hair, eyewear, headwear
    drawHumanFace(grid, pal, { blink, mouth });
    if (FACIAL[parts.facial]) stamp(grid, FACIAL[parts.facial], pal);
    if (hair.front) stamp(grid, hair.front, pal);
    if (EYEWEAR[parts.eyewear]) stamp(grid, EYEWEAR[parts.eyewear], pal);
    for (const e of extras) if (e.layer === 'top') stamp(grid, e.part, pal);
    if ((parts.extras || []).includes('crown')) stamp(grid, EXTRAS.feather.part, pal);
  }

  if (artifact.main) artifact.main(api, frame);

  outline(grid, pal.o);

  if (extras.some((e) => e.layer === 'halo')) drawHalo(grid);
  if (artifact.fx) artifact.fx(artifactApi(grid, pal, artPal, { fxLayer: true, talking }), frame);
  return grid;
}

export function artifactFrames(look) {
  return getArtifact(look.artifact || 'none').frames || 1;
}

// ---------------------------------------------------------------------------
// Browser rendering

export function gridToCanvas(grid, canvas) {
  const c = canvas || document.createElement('canvas');
  c.width = CW;
  c.height = CH;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, CW, CH);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const color = grid.px[y * CW + x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

export class SpriteCache {
  constructor(look) {
    this.look = look;
    this.frames = artifactFrames(look);
    this.map = new Map();
  }
  get({ blink = false, mouth = false, art = 0, talking = false } = {}) {
    const key = `${+blink}${+mouth}${art % this.frames}${+talking}`;
    let c = this.map.get(key);
    if (!c) {
      c = gridToCanvas(buildFrame(this.look, { blink, mouth, art, talking }));
      this.map.set(key, c);
    }
    return c;
  }
}

// Draw a head-and-shoulders portrait (for the dialog box) into a canvas.
export function drawPortrait(canvas, look, { mouth = false, blink = false } = {}) {
  const src = gridToCanvas(buildFrame({ ...look, artifact: 'none' }, { mouth, blink }));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sx = OX + 1;
  const sy = 0;
  const size = 22;
  ctx.drawImage(src, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
}
