// Placement of the Morelian countryside around the battle.
import { add, lerp, norm } from '../core/math.mjs';
import { Rng } from '../core/rng.mjs';
import { height } from './terrain.mjs';
import { tree, hedge, stoneWall, house, church, haystack, cart, fence, cow, basket, pitchfork } from './props.mjs';
import { fromLine } from './layout.mjs';

const G = (x, z, dy = 0) => [x, height(x, z) + dy, z];

export function buildCountryside() {
  const rng = new Rng(777);
  const items = [];
  const push = (pos, radius, h, build, o = {}) => items.push({ kind: 'prop', pos, radius, height: h, build, ...o });

  // --- trees: a great oak behind the line, elms along the lane, poplars by the farm ---
  const trees = [
    [20.5, 43, 15, 'oak', 1.15], [58, 150, 17, 'oak', 1], [74, 168, 15, 'oak', 0.9], [46, 205, 21, 'poplar', 1],
    [52, 212, 20, 'poplar', 1], [96, 240, 16, 'oak', 1.1], [140, 330, 18, 'oak', 1], [20, 140, 14, 'oak', 0.8],
    [180, 420, 17, 'oak', 1], [240, 520, 22, 'poplar', 1], [250, 530, 21, 'poplar', 1],
    // along the far ridge on the enemy side, veiled in smoke
    [-230, 520, 16, 'oak', 1], [-300, 620, 18, 'oak', 1.1], [-160, 700, 15, 'oak', 1], [-380, 820, 17, 'oak', 1],
    [-90, 460, 14, 'oak', 0.9],
    // mid-distance along the line's rise
    [26, 300, 15, 'oak', 1], [60, 420, 16, 'oak', 1.1],
  ];
  for (const [x, z, h, kind, sp] of trees) {
    const base = G(x, z, -0.3);
    const r = new Rng(x * 13 + z);
    push(add(base, [0, h * 0.6, 0]), h * 0.6, h, (lod) => tree(r.fork(1), base, h, { spread: sp, lod: Math.min(1, lod * 2), kind }));
  }
  // --- hedgerows bounding the fields behind the line ---
  const hedges = [
    [[14, 105], [40, 118], [70, 132], [110, 150], [160, 175]],
    [[90, 230], [130, 260], [190, 300], [260, 340]],
    [[-40, 330], [-10, 380], [30, 440], [80, 500]],
    [[170, 175], [200, 240], [230, 310]],
  ];
  hedges.forEach((pts, i) => {
    const P = pts.map(([x, z]) => G(x, z));
    const c = P[Math.floor(P.length / 2)];
    const r = new Rng(900 + i);
    push(add(c, [0, 2, 0]), 90, 3, (lod) => hedge(r.fork(1), P, { h: 1.9, lod: Math.min(1, lod * 3), gap: 0.08 }));
  });
  // --- dry stone wall running diagonally across the pasture behind the line ---
  {
    const P = [[7.5, 26], [12, 36], [18, 47], [27, 60], [38, 74], [52, 92]].map(([x, z]) => G(x, z));
    const r = new Rng(31);
    push(add(P[2], [0, 1, 0]), 40, 1.5, () => stoneWall(r.fork(1), P, { h: 1.0, broken: [[G(17, 45), 2.5]] }));
  }
  // --- broken fence by the lane, an abandoned cart, a basket and pitchfork ---
  {
    const P = [[10.5, 16], [11.5, 19], [12.6, 22], [13.8, 25]].map(([x, z]) => G(x, z));
    const r = new Rng(32);
    push(add(P[1], [0, 0.6, 0]), 5, 1.3, () => fence(r.fork(1), P, { broken: 0.45 }));
    const cp = G(19, 44);
    push(add(cp, [0, 1, 0]), 3, 2, () => cart(r.fork(2), cp, 0.9, 0.35));
    const bp = G(6.8, 12.5, 0.02);
    push(bp, 0.5, 0.4, () => basket(bp, 0.6));
    const fp = G(5.6, 11.2, 0.03);
    push(fp, 1.2, 0.3, () => pitchfork(fp, [0.8, 0.04, 0.55]));
  }
  // --- haystacks in the far fields ---
  for (const [x, z, r] of [[70, 262, 2.6], [96, 300, 2.4], [140, 420, 2.8], [118, 405, 2.5], [-60, 380, 2.4]]) {
    const c = G(x, z, -0.2);
    const rr = new Rng(x + z);
    push(add(c, [0, r, 0]), r * 1.5, r * 2, () => haystack(rr, c, r));
  }
  // --- livestock fleeing through the haze ---
  for (let i = 0; i < 6; i++) {
    const x = 120 + i * 7 + rng.range(-3, 3), z = 330 + rng.range(-10, 10);
    const c = G(x, z);
    const rr = new Rng(100 + i);
    push(add(c, [0, 1, 0]), 2, 1.8, () => cow(rr, c, 0.4 + rng.range(-0.3, 0.3)));
  }
  // --- the Morelian village on its hill, with church and orchards ---
  {
    const vc = [1180, 0, 2350];
    for (let i = 0; i < 24; i++) {
      const x = vc[0] + rng.gclip(0, 90), z = vc[2] + rng.gclip(0, 70);
      const c = G(x, z, -0.3);
      const rr = new Rng(200 + i);
      const w = rng.range(7, 12), d = rng.range(9, 16), h = rng.range(5, 8);
      push(add(c, [0, h, 0]), 12, 14, () => house(rr, c, rng.range(-0.5, 0.5) + (i % 2) * 1.57, w, d, h, rng.range(3, 5)));
    }
    const cc = G(vc[0] + 20, vc[2] - 10, -0.3);
    push(add(cc, [0, 10, 0]), 20, 32, () => church(new Rng(5), cc, 0.3));
    // manor/estate on the right
    const mc = G(820, 1650, -0.3);
    push(add(mc, [0, 8, 0]), 20, 16, () => house(new Rng(6), mc, 0.2, 24, 12, 11, 6));
    // orchards: rows of small round trees on the slope
    for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) {
      const x = 880 + c * 14 + r * 3, z = 1850 + r * 16;
      const base = G(x, z, -0.2);
      const rr = new Rng(r * 100 + c);
      push(add(base, [0, 3, 0]), 5, 6, (lod) => tree(rr, base, 6.5, { spread: 1.2, lod: 0.25, kind: 'oak' }));
    }
  }
  // distant farmsteads scattered in the fields
  for (const [x, z] of [[420, 900], [-520, 1300], [300, 1400], [650, 700]]) {
    const c = G(x, z, -0.3);
    const rr = new Rng(x);
    push(add(c, [0, 6, 0]), 14, 12, () => house(rr, c, rng.range(0, 3), 12, 9, 6, 4));
  }
  return items;
}
