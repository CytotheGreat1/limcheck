// Smoke, dust, muzzle flashes, shell bursts and flying earth: the only evidence of the hidden enemy.
import { add, sub, mul, madd, norm, lerp, clamp, smoothstep, rotAxis } from '../core/math.mjs';
import { Rng } from '../core/rng.mjs';
import { Smoke } from '../fx/smoke.mjs';
import { earthSpray, turfKick } from '../fx/debris.mjs';
import { fromLine, L, A } from '../world/layout.mjs';
import { height } from '../world/terrain.mjs';

const POWDER = [0.93, 0.91, 0.87];
const POWDER_W = [0.98, 0.95, 0.88];
const DUST = [0.66, 0.56, 0.43];
const EARTH = [0.42, 0.35, 0.27];
const SHELL = [0.32, 0.31, 0.3];

function gp(s, a, h = 0) {
  const [x, z] = fromLine(s, a);
  return [x, height(x, z) + h, z];
}
// world point from screen-ish placement: slope k = x/z, depth z
function wp(k, z, h = 0) {
  const x = k * z;
  return [x, height(x, z) + h, z];
}

export function buildEffects(opts = {}) {
  const rng = new Rng(4242);
  const sm = new Smoke();
  const items = [];

  // ---- 1. enemy gun smoke: heavy banks low over the far left countryside ----
  for (let i = 0; i < 70; i++) {
    const z = lerp(160, 900, Math.pow(rng.next(), 0.8));
    const k = rng.range(-0.75, -0.12);
    const r = rng.range(14, 55) * (z / 400);
    const h = rng.range(0.2, 0.9) * r;
    sm.add(wp(k, z, h), r, rng.range(0.012, 0.03) * (300 / Math.max(200, z)), { col: POWDER, noise: 1.2 });
  }
  // the banks thicken into rolling billows on the horizon
  for (let i = 0; i < 40; i++) {
    const z = rng.range(500, 1600);
    const k = rng.range(-0.62, 0.05);
    const r = rng.range(40, 120);
    sm.add(wp(k, z, r * rng.range(0.1, 0.6)), r, rng.range(0.004, 0.01), { col: POWDER_W, noise: 1.3 });
  }
  // muzzle flashes barely visible through the smoke (far left)
  for (let i = 0; i < 7; i++) {
    const z = rng.range(320, 620), k = rng.range(-0.5, -0.24);
    const p = wp(k, z, rng.range(1.5, 3));
    sm.add(p, rng.range(1.6, 3.2), 0.6, { col: [1, 0.8, 0.5], emit: [2.8, 1.7, 0.7], noise: 0.6, lit: 0 });
    sm.add(madd(p, [0, 1, 0], 4), rng.range(8, 12), 0.05, { col: POWDER_W, noise: 1.2 });
  }

  // ---- 2. smoke drifting across the field ahead (left) toward the line ----
  for (let i = 0; i < 90; i++) {
    const z = lerp(14, 140, Math.pow(rng.next(), 1.2));
    const k = rng.range(-0.62, -0.02);
    const r = rng.range(3, 10) * (0.6 + z / 120);
    sm.add(wp(k, z, rng.range(0.1, 0.8) * r), r, rng.range(0.012, 0.04), { col: POWDER, noise: 1.3 });
  }

  // ---- 3. thin sheets drifting between the ranks ----
  for (let i = 0; i < 130; i++) {
    const s = lerp(7, 70, Math.pow(rng.next(), 0.8));
    const a = rng.range(-5, 7);
    const r = rng.range(1.2, 3.5) * (0.7 + s / 60);
    sm.add(gp(s, a, rng.range(0.4, 2.6)), r, rng.range(0.03, 0.09), { col: POWDER, noise: 1.5 });
  }
  // a few very thin veils close to the viewer for layered depth
  for (const [s, a, h, r, d] of [[6.5, 4.5, 2.4, 2.2, 0.05], [9, 1.5, 3.2, 2.6, 0.035], [4.5, 6, 1.5, 1.8, 0.05], [12, -4, 2, 3, 0.04]]) {
    sm.add(gp(s, a, h), r, d, { col: POWDER, noise: 1.6 });
  }

  // ---- 4. the far line dissolving into haze ----
  for (let i = 0; i < 110; i++) {
    const s = lerp(55, 330, Math.pow(rng.next(), 0.7));
    const a = rng.range(-3, 22);
    const r = rng.range(5, 16) * (0.6 + s / 150);
    const dens = rng.range(0.012, 0.03) * smoothstep(30, 160, s) * (80 / (40 + s * 0.5));
    sm.add(gp(s, a, rng.range(0.2, 0.9) * r), r, dens, { col: POWDER, noise: 1.2 });
  }

  // ---- 5. friendly batteries far to the right-rear, and a burning farmstead ----
  for (let i = 0; i < 45; i++) {
    const z = rng.range(180, 900), k = rng.range(0.28, 0.62);
    const r = rng.range(15, 50) * (z / 400);
    sm.add(wp(k, z, rng.range(0.2, 0.8) * r), r, rng.range(0.008, 0.02), { col: POWDER, noise: 1.2 });
  }
  {
    // smoke column from a burning barn: rising, leaning with the wind to the right
    const base = wp(0.44, 780, 4);
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const p = [base[0] + t * t * 160, base[1] + t * 240, base[2] + t * 40];
      sm.add(p, 10 + t * 55, 0.02 * (1 - t * 0.6), { col: lerp(0.35, 0.7, t) > 0 ? [lerp(0.38, 0.72, t), lerp(0.36, 0.7, t), lerp(0.34, 0.66, t)] : POWDER, noise: 1.3 });
    }
  }

  // ---- 6. the canister strike: dust spurts and turf erupting around the struck files ----
  {
    const origin = gp(-40, 220, 1); // direction the canister came from
    for (let i = 0; i < 46; i++) {
      const s = rng.range(3.2, 9.5), a = rng.range(-1.2, 7.5);
      const p = gp(s, a, 0.02);
      const away = norm(sub(p, origin));
      const r = rng.range(0.07, 0.26);
      sm.add(madd(p, [0, 1, 0], r * 0.8), r, rng.range(2.5, 7), { col: DUST, noise: 0.9 });
      if (i % 3 === 0) sm.add(madd(madd(p, [0, 1, 0], r * 2.2), away, r), r * 1.7, rng.range(0.4, 1.0), { col: DUST, noise: 1.3 });
      if (i % 2 === 0) {
        const parts = turfKick(rng, p, away, rng.int(3, 7), 0.028);
        items.push({ kind: 'debris', pos: p, radius: 0.5, height: 0.6, build: () => parts, noShadow: true });
      }
    }
    // splinters and a burst of dust right among the falling men
    for (const [s, a, h, r] of [[5.8, 1.4, 0.9, 0.5], [6.6, 2.2, 1.3, 0.6], [5.2, 2.6, 0.5, 0.45]]) {
      sm.add(gp(s, a, h), r, 0.7, { col: DUST, noise: 1.3 });
    }
  }

  // ---- 7. round shot impacts: earth thrown up, pale dust ----
  const impact = (s, a, scale, dir) => {
    const p = gp(s, a, 0);
    const d = norm(dir || [rng.gclip(0, 0.3), 1.8, rng.gclip(0, 0.3)]);
    const parts = earthSpray(rng, p, d, { count: Math.round(70 * scale), spread: 0.55, size: 0.07 * scale, reach: 2.2 * scale, height: 3.2 * scale });
    items.push({ kind: 'debris', pos: madd(p, [0, 1, 0], 1.2 * scale), radius: 2.5 * scale, height: 3 * scale, build: () => parts, noShadow: true });
    for (let i = 0; i < 16; i++) {
      const q = madd(p, [rng.gclip(0, 0.5), rng.range(0.2, 2.6), rng.gclip(0, 0.5)], scale);
      sm.add(q, rng.range(0.5, 1.4) * scale, rng.range(0.3, 0.9) / scale, { col: i < 8 ? EARTH : DUST, noise: 1.3 });
    }
    sm.add(madd(p, [0, 1, 0], 1.5 * scale), 2.6 * scale, 0.18 / scale, { col: DUST, noise: 1.4 });
  };
  impact(16, 7.5, 1.1);
  impact(24, -10, 1.0);
  impact(46, 14, 1.6);
  // a ricocheting ball skipping across the field toward the line
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const s = lerp(60, 33, t), a = lerp(70, 9, t);
    const p = gp(s, a, 0.3);
    const r = lerp(1.6, 0.9, t);
    sm.add(p, r, 0.5, { col: DUST, noise: 1.3 });
    sm.add(madd(p, [0, 1, 0], r), r * 1.6, 0.12, { col: DUST, noise: 1.4 });
  }

  // ---- 8. shell bursts in the air ----
  const burst = (s, a, h, r, fresh) => {
    const p = gp(s, a, h);
    sm.add(p, r, 0.9, { col: SHELL, noise: 1.2 });
    for (let i = 0; i < 7; i++) sm.add(madd(p, [rng.gclip(0, 1), rng.gclip(0, 0.6), rng.gclip(0, 1)], r * 0.6), r * rng.range(0.5, 0.8), 0.6, { col: SHELL, noise: 1.3 });
    if (fresh) sm.add(p, r * 0.35, 3, { col: [1, 0.85, 0.6], emit: [3.5, 2.2, 1.0], noise: 0.8, lit: 0 });
  };
  burst(22, 26, 7.5, 1.8, true);
  burst(40, 55, 11, 2.6, false);
  burst(9, 60, 14, 2.2, false);

  // ---- 9. distant dust from shot falling on the fields ----
  for (let i = 0; i < 14; i++) {
    const z = rng.range(60, 400), k = rng.range(-0.55, 0.45);
    const p = wp(k, z, 0);
    const r = rng.range(2, 6) * (z / 150);
    sm.add(madd(p, [0, 1, 0], r * 0.6), r, 0.08 * (150 / z), { col: DUST, noise: 1.3 });
  }
  return { smoke: sm, items };
}
