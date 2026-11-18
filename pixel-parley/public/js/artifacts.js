// Artifacts (props) drawn beside each figure. Coordinates are in the sprite's
// 24x32 body grid; the figure's right hand (on the viewer's left) is at x 5-6,
// y 23-24. Negative x reaches into the sprite canvas's left margin.
//
// Each artifact can draw into three layers:
//   back(api, f)  behind the body (outlined)
//   main(api, f)  in front of the body (outlined)
//   fx(api, f)    effects on top, never outlined (glints, notes, orbits)
// `f` is the animation frame (0 .. frames-1). `api.talking` is true while the
// owner is speaking. Palette keys 's'/'S' resolve to the owner's skin, for
// fingers wrapped around a handle.

export const ARTIFACT_PALETTE = {
  w: '#eef1f6', W: '#a9b1c2', // blade, chalk
  e: '#f7f3e6', // white
  g: '#e0b545', G: '#a87a24', // gold
  B: '#6b3f1f', b: '#9a6232', // wood dark / light
  r: '#d0383f', R: '#8e1f2a', // red
  u: '#5fa8e8', U: '#bfe4ff', // blue
  y: '#f3dc96', Y: '#cfae62', // parchment, bamboo
  p: '#f08fb8', P: '#fcd4e6', // pink
  l: '#4f9a3a', L: '#2f6b25', // green
  k: '#24212c', K: '#4a4656', // black / gray
  j: '#cfd3dc', J: '#8d93a3', // silver
  q: '#2f4f3a', Q: '#3d6249', // chalkboard
  f: '#e8742a', F: '#a84a14', // fox
  n: '#ffd75e', // music note
  o: '#fff2b8', // sparkle
};

function circlePoints(cx, cy, r) {
  const pts = new Set();
  for (let a = 0; a < 360; a += 4) {
    const x = Math.round(cx + r * Math.cos((a * Math.PI) / 180));
    const y = Math.round(cy + r * Math.sin((a * Math.PI) / 180));
    pts.add(`${x},${y}`);
  }
  return [...pts].map((s) => s.split(',').map(Number));
}

// The formula on Einstein's chalkboard, assembled from tiny glyphs.
const FORMULA_GLYPHS = [
  ['##', '#.', '##', '#.', '##'], // E
  ['..', '##', '..', '##', '..'], // =
  ['.....', '.....', '#####', '#.#.#', '#.#.#'], // m
  ['..', '..', '##', '#.', '##'], // c
  ['##', '.#', '#.', '##', '..'], // ² (superscript)
];
const FORMULA_ROWS = (() => {
  const rows = ['', '', '', '', ''];
  FORMULA_GLYPHS.forEach((g, i) => {
    for (let r = 0; r < 5; r++) rows[r] += g[r] + (i < 3 ? '.' : '');
  });
  return rows.map((r) => r.replace(/#/g, 'e'));
})();

export const ARTIFACTS = {
  gladius: {
    frames: 10,
    main(a) {
      a.px(4, 8, 'w');
      for (let y = 9; y <= 21; y++) {
        a.px(4, y, 'w');
        a.px(5, y, 'W');
      }
      a.map(['GgggggG'], 1, 22); // crossguard x1-7
      a.map(['sss', 'SSS'], 4, 23); // fist around the grip
      a.map(['gg'], 4, 25); // pommel
    },
    fx(a, f) {
      if (f < 4) a.fx(4, 19 - f * 3, 'o');
    },
  },

  paintbrush: {
    frames: 8,
    main(a) {
      // palette in the left hand (viewer's right)
      a.map(['.bbbbb.', 'bbrbubb', 'bbbbbyb', '.blbbb.', '..bbb..'], 17, 21);
      a.px(18, 22, 's'); // thumb through the hole
      // brush in the right hand (viewer's left)
      a.px(5, 22, 'B');
      a.px(4, 21, 'B');
      a.px(3, 20, 'B');
      a.px(2, 19, 'j');
      a.px(1, 18, 'r');
      a.px(0, 17, 'r');
      a.map(['ss'], 5, 23);
    },
    fx(a, f) {
      if (f === 2 || f === 3) a.fx(-1, 16, 'o');
    },
  },

  charkha: {
    frames: 4,
    main(a, f) {
      const cx = -5;
      const cy = 25;
      for (const [x, y] of circlePoints(cx, cy, 4)) a.px(x, y, 'b');
      const angle = (f * Math.PI) / 8;
      for (let k = 0; k < 4; k++) {
        const t = angle + (k * Math.PI) / 4;
        a.line(cx, cy, Math.round(cx + 3 * Math.cos(t)), Math.round(cy + 3 * Math.sin(t)), 'B');
        a.line(cx, cy, Math.round(cx - 3 * Math.cos(t)), Math.round(cy - 3 * Math.sin(t)), 'B');
      }
      a.px(cx, cy, 'g'); // hub
      for (let y = 29; y <= 29; y++) a.px(cx, y, 'B'); // stand
      a.map(['bbbbbbbbbbbbb', 'BBBBBBBBBBBBB'], -12, 30); // base plank
      a.map(['jjj'], -12, 27); // spindle
      a.px(-11, 28, 'B');
      a.px(-11, 29, 'B');
    },
    fx(a) {
      a.line(-5, 21, -10, 27, 'e'); // cotton thread to the spindle
    },
  },

  lotus: {
    frames: 8,
    main(a) {
      a.map(['..pp..', 'p.PP.p', 'pPppPp', '.pppp.'], 3, 19);
      a.map(['.ll.'], 4, 22);
    },
    fx(a, f) {
      if (f === 1 || f === 2) a.fx(2, 18, 'o');
      if (f === 5 || f === 6) a.fx(9, 17, 'o');
    },
  },

  crook: {
    frames: 1,
    main(a) {
      for (let y = 6; y <= 31; y++) a.px(4, y, 'b');
      a.map(['.bb.', 'b..b', 'b...', 'b...'], 1, 2); // hook curling outward
      a.px(4, 5, 'b');
      a.px(4, 4, 'b');
      a.map(['s', 'S'], 4, 23); // fingers over the staff
    },
  },

  warmap: {
    frames: 1,
    main(a) {
      a.map(['YyyyyyY', 'yuyyryy', 'yrrrrry', 'yyuyryy', 'YyyyyyY'], -3, 20);
      a.map(['ss', 'SS'], 4, 23);
    },
  },

  phone: {
    frames: 12,
    main(a) {
      a.map(['kkkk', 'kUuk', 'kuUk', 'kuuk', 'kkKk'], 3, 17);
      a.map(['ss'], 5, 22);
    },
    fx(a, f) {
      if (f >= 6) {
        const bob = f % 2 === 0 ? 0 : -1;
        a.fxMap(['.rrr.', 'rrerr', 'rrerr', '.rrr.'], 0, 12 + bob);
      }
    },
  },

  microphone: {
    frames: 6,
    main(a) {
      a.map(['.j.', 'jJj', 'jJj', '.j.', '.k.'], 1, 10);
      for (let y = 15; y <= 30; y++) a.px(2, y, 'K');
      a.map(['kkkkk'], 0, 31);
    },
    fx(a, f) {
      if (a.talking) {
        if (f % 3 !== 2) a.fx(-1, 12, 'U');
        if (f % 3 === 1) {
          a.fx(-2, 11, 'U');
          a.fx(-2, 13, 'U');
        }
      } else if (f < 3) {
        a.fx(2, 14, 'r'); // on-air light
      }
    },
  },

  book: {
    frames: 1,
    main(a) {
      a.map(['Rrrre', 'Rggge', 'Rrrre', 'Rrgre', 'Rrrre', 'Rrrre'], 0, 19);
      a.map(['s', 'S'], 4, 23);
    },
  },

  flute: {
    frames: 8,
    main(a) {
      const pts = [
        [4, 22],
        [3, 21],
        [2, 20],
        [1, 19],
        [0, 18],
        [-1, 17],
        [-2, 16],
      ];
      pts.forEach(([x, y], i) => a.px(x, y, i % 2 === 1 ? 'B' : 'b'));
      a.px(-3, 15, 'r'); // tassel knot
      a.map(['ss'], 5, 23);
    },
    fx(a, f) {
      if (f < 5) a.fxMap(['.n', '.n', 'nn', 'nn'], -6 - (f >> 1), 12 - f * 2);
    },
  },

  chalkboard: {
    frames: 1,
    // Sits at chest height so the chalk stays clear of Einstein's white hair.
    back(a) {
      a.map(['BBBBBBBBBBBBBBBBBB'], -13, 11);
      for (let y = 12; y <= 18; y++) a.map(['B' + 'q'.repeat(16) + 'B'], -13, y);
      a.map(['BBBBBBBBBBBBBBBBBB'], -13, 19);
      for (let y = 20; y <= 31; y++) {
        a.px(-11, y, 'B');
        a.px(1, y, 'B');
      }
    },
    fx(a) {
      a.fxMap(FORMULA_ROWS, -12, 13);
    },
  },

  bamboo: {
    frames: 1,
    main(a) {
      a.map(['yYyYyY', 'kkkkkk', 'yYyYyY', 'yYyYyY', 'kkkkkk', 'yYyYyY'], -2, 18);
      a.map(['s', 'S'], 4, 23);
    },
  },

  foxmask: {
    frames: 1,
    main(a) {
      a.map(['F.....F', 'fF...Ff', 'fffffff', 'fkfffkf', 'efffffe', '.eekee.', '..eee..'], -3, 11);
      a.line(0, 18, 4, 22, 'B'); // handle
      a.map(['s', 'S'], 5, 23);
    },
  },

  orrery: {
    frames: 16,
    main(a, f) {
      const cx = -6;
      const cy = 12;
      a.map(['.g.', 'gng', '.g.'], cx - 1, cy - 1); // the Sun
      const t = (f / 16) * Math.PI * 2;
      a.px(Math.round(cx + 6 * Math.cos(t)), Math.round(cy + 2 * Math.sin(t)), 'u'); // Earth
      const t2 = (f / 8) * Math.PI * 2;
      a.px(Math.round(cx + 3 * Math.cos(t2)), Math.round(cy + 1.4 * Math.sin(t2)), 'r'); // inner planet
    },
    fx(a) {
      for (let deg = 0; deg < 360; deg += 30) {
        const x = Math.round(-6 + 6 * Math.cos((deg * Math.PI) / 180));
        const y = Math.round(12 + 2 * Math.sin((deg * Math.PI) / 180));
        a.fxUnder(x, y, 'J');
      }
    },
  },

  sparkle: {
    frames: 6,
    fx(a, f) {
      const cx = -3;
      const cy = 11 - (f < 3 ? 0 : 1);
      a.fx(cx, cy, 'o');
      a.fx(cx - 1, cy, 'n');
      a.fx(cx + 1, cy, 'n');
      a.fx(cx, cy - 1, 'n');
      a.fx(cx, cy + 1, 'n');
      if (f % 3 === 1) {
        a.fx(cx - 2, cy, 'n');
        a.fx(cx + 2, cy, 'n');
        a.fx(cx, cy - 2, 'n');
        a.fx(cx, cy + 2, 'n');
      }
    },
  },

  quill: {
    frames: 1,
    main(a) {
      a.map(['ee.....', 'eee....', '.eee...', '..eee..', '...ee..', '....k..', '.....k.', '......k'], -2, 13);
      a.px(5, 21, 'k');
      a.px(5, 22, 'k');
      a.map(['ss'], 5, 23);
    },
  },

  scroll: {
    frames: 1,
    main(a) {
      a.map(['YyyyY', 'YkkyY', 'YyyyY', 'YkkyY', 'YyyyY'], 0, 19);
      a.map(['s', 'S'], 4, 23);
    },
  },

  none: { frames: 1 },
};

export function getArtifact(id) {
  return ARTIFACTS[id] || ARTIFACTS.none;
}
