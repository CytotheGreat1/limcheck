// Countryside props: broad-canopied trees, hedgerows, stone walls, a village with its church,
// orchards, haystacks, an abandoned cart, broken fencing and livestock fleeing through the haze.
import { Frame, add, sub, mul, madd, norm, cross, lerp, clamp, smoothstep, hex, rotAxis, vlerp, perp, len } from '../core/math.mjs';
import { gridSurface, mergeMeshes } from '../core/mesh.mjs';
import { Rng, noise3, fbm2, NoiseTex } from '../core/rng.mjs';
import { S, resetS, shadeLit, perturb } from '../core/light.mjs';
import { limb, ellipsoid, superBox, pipe } from '../figure/geom.mjs';
import { height } from './terrain.mjs';

const LEAF = [hex('#29321a'), hex('#323c1e'), hex('#3a4322'), hex('#434a26')];
const BARK = hex('#3a3128');
const PT = { a: null };
function tex() { if (!PT.a) PT.a = new NoiseTex(256, 8, 4, 55.5); return PT.a; }

function foliageMat(tone, seed) {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.45; S.trans = 0.15; S.sheen = 0.05;
      const t = tex();
      const n = t.at(F.px * 0.9 + seed, F.py * 0.9 + F.pz * 0.5);
      const n2 = t.at(F.px * 3.1, F.py * 3.1 - F.pz);
      const n3 = t.at(F.px * 9.7 + seed, F.py * 9.7 + F.pz * 3);
      // leafy holes at the silhouette
      if (n3 + n2 * 0.5 > 0.55 + 0.4 * clamp(F.ex, 0, 1)) { F.discard = true; return; }
      // leafy clumps: perturb normal with noise gradient for dappled light
      perturb(F, n * 0.8 + n3 * 0.5, n2 * 0.8 + n3 * 0.5, 1);
      const k = 0.7 + 0.35 * (0.5 + 0.5 * n) + 0.2 * n2 + 0.15 * n3;
      S.ao = 0.4 + 0.6 * clamp(F.ex, 0, 1);
      F.tag = 9;
      shadeLit(F, tone[0] * k, tone[1] * k, tone[2] * k);
    },
  };
}
function barkMat() {
  return {
    shade(F) {
      resetS(); S.wrap = 0.3;
      const k = 0.8 + 0.3 * tex().at(F.u * 2, F.v * 6);
      F.tag = 9;
      shadeLit(F, BARK[0] * k, BARK[1] * k, BARK[2] * k);
    },
  };
}

// A broad-canopied tree (oak/elm). base on ground, H height.
export function tree(rng, base, H, { spread = 1, lod = 1, kind = 'oak' } = {}) {
  const out = [];
  const poplar = kind === 'poplar';
  const trunkH = H * (poplar ? 0.22 : 0.3);
  const lean = [rng.gclip(0, 0.07), 1, rng.gclip(0, 0.07)];
  const top = madd(base, norm(lean), trunkH);
  const tr = limb(base, top, [1, 0, 0], (t) => { const r = H * (poplar ? 0.022 : 0.03) * (1.25 - 0.35 * t) * (t < 0.08 ? 1.25 - t * 3 : 1); return [r, r]; }, {
    nu: Math.max(6, Math.round(14 * lod)), nv: 6, capB: H * 0.02,
    disp: (t, th) => 0.08 * noise3(t * 5, Math.cos(th) * 2, Math.sin(th) * 2),
  });
  tr.material = barkMat();
  out.push(tr);
  // crown: clumps on a dome, big limbs reaching into them
  const crownC = madd(top, [0, 1, 0], H * (poplar ? 0.36 : 0.2));
  const RH = H * (poplar ? 0.12 : 0.36) * spread, RV = H * (poplar ? 0.42 : 0.3);
  const nc = poplar ? 16 : 30;
  const clumps = [];
  for (let i = 0; i < nc; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const dy = poplar ? rng.range(-0.9, 0.95) : rng.range(-0.35, 1);
    const hr = Math.sqrt(Math.max(0, 1 - dy * dy));
    const k = rng.range(0.55, 1.0);
    const c = add(crownC, [Math.cos(ang) * hr * RH * k, dy * RV * k, Math.sin(ang) * hr * RH * k]);
    const r = H * (poplar ? rng.range(0.07, 0.1) : rng.range(0.1, 0.16)) * spread;
    clumps.push([c, r]);
  }
  // limbs: from the trunk top toward a few outer clumps
  const nb = poplar ? 3 : 6;
  for (let i = 0; i < nb; i++) {
    const [c] = clumps[i];
    const e = vlerp(top, c, 0.85);
    const br = limb(madd(top, [0, -H * 0.04, 0], 1), e, [1, 0, 0], (t) => { const r = H * 0.018 * (1 - 0.75 * t); return [r, r]; }, { nu: 6, nv: 4, bend: { dir: [0, 1, 0], amt: H * 0.03 } });
    br.material = barkMat();
    out.push(br);
  }
  const tone = rng.pick(LEAF);
  const seed = rng.range(0, 100);
  for (const [c, r] of clumps) {
    const fr = Frame.fromYaw(c, rng.range(0, 6.28));
    const m = ellipsoid(fr, r * 1.1, r * 0.85, r, {
      nu: Math.max(8, Math.round(30 * lod)), nv: Math.max(6, Math.round(20 * lod)),
      deform: (p) => {
        const n = noise3(p[0] / r * 1.7 + seed, p[1] / r * 1.7, p[2] / r * 1.7) * 0.4 + noise3(p[0] / r * 5 + seed, p[1] / r * 5, p[2] / r * 5) * 0.18 + noise3(p[0] / r * 13, p[1] / r * 13, p[2] / r * 13 + seed) * 0.07;
        return [p[0] * (1 + n), p[1] * (1 + n) - (p[1] < 0 ? p[1] * 0.25 : 0), p[2] * (1 + n)];
      },
      exFn: (u, v) => 1 - v * 0.8,
    });
    m.material = foliageMat(tone, seed);
    out.push(m);
  }
  return out;
}

// Hedgerow along a polyline of ground points: overlapping bushes
export function hedge(rng, pts, { h = 1.8, lod = 0.3, gap = 0 } = {}) {
  const out = [];
  const tone = rng.pick(LEAF);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = len(sub(b, a));
    const n = Math.max(1, Math.round(L / (h * 1.1)));
    for (let k = 0; k < n; k++) {
      if (gap && rng.chance(gap)) continue;
      const t = (k + rng.next()) / n;
      const p = vlerp(a, b, t);
      p[1] = height(p[0], p[2]);
      const hh = h * rng.range(0.7, 1.35);
      const c = [p[0], p[1] + hh * 0.45, p[2]];
      const fr = Frame.fromYaw(c, rng.range(0, 6.28));
      const seed = rng.range(0, 99);
      const m = ellipsoid(fr, hh * 0.75, hh * 0.55, hh * 0.6, {
        nu: Math.max(6, Math.round(14 * lod)), nv: Math.max(5, Math.round(9 * lod)),
        deform: (q) => { const nn = noise3(q[0] / hh * 2 + seed, q[1] / hh * 2, q[2] / hh * 2) * 0.3; return [q[0] * (1 + nn), q[1] * (1 + nn), q[2] * (1 + nn)]; },
        exFn: (u, v) => 1 - v * 0.8,
      });
      m.material = foliageMat(tone, seed);
      out.push(m);
    }
  }
  return out;
}

// Dry stone wall along ground points
const STONE = hex('#8a8272');
export function stoneWall(rng, pts, { h = 1.0, w = 0.55, broken = [] } = {}) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = norm(sub(b, a));
    const side = norm(cross([0, 1, 0], d));
    const L = len(sub(b, a));
    const nseg = Math.max(2, Math.round(L / 0.5));
    const m = gridSurface(8, nseg, (u, v) => {
      const p = vlerp(a, b, v);
      const g = height(p[0], p[2]);
      let hh = h * (1 + 0.12 * noise3(p[0] * 0.8, 0, p[2] * 0.8));
      for (const [bc, br] of broken) { const dd = len(sub(p, bc)); if (dd < br) hh *= 0.35 + 0.65 * (dd / br); }
      // cross-section: trapezoid with rounded top
      const th = u * Math.PI * 2;
      const cx = Math.cos(th), cy = Math.sin(th);
      const ww = w * (0.5 - 0.12 * Math.max(0, cy));
      const y = cy > 0 ? hh * (0.55 + 0.45 * cy) : hh * 0.55 * (1 + cy);
      return madd([p[0], g - 0.05 + y, p[2]], side, cx * ww);
    }, { wrapU: true, flip: true });
    m.material = {
      shade(F) {
        resetS(); S.wrap = 0.25;
        // irregular stone courses
        const u = (F.px * d[0] + F.pz * d[2]) * 3.2, v = F.py * 7;
        const row = Math.floor(v), off = (row % 2) * 0.5;
        const cu = u + off + tex().at(row * 0.3, 0.1) * 2;
        const fu = cu - Math.floor(cu), fv = v - row;
        const mortar = Math.min(fu, 1 - fu, fv * 1.6, (1 - fv) * 1.6);
        const k = (0.75 + 0.4 * tex().at(Math.floor(cu) * 0.37, row * 0.53)) * (mortar < 0.08 ? 0.55 : 1);
        perturb(F, (fu - 0.5) * 0.6, (fv - 0.5) * 0.4, mortar < 0.12 ? 0 : 1);
        const lichen = smoothstep(0.2, 0.6, tex().at(F.px * 0.7, F.pz * 0.7 + F.py));
        F.tag = 9;
        shadeLit(F, STONE[0] * k * (1 - lichen * 0.2), STONE[1] * k * (1 - lichen * 0.05), STONE[2] * k * (1 - lichen * 0.25));
      },
    };
    out.push(m);
  }
  return out;
}

// Simple house: box walls + gable roof
const WALLS = ['#b8aa8c', '#c2b38f', '#a99a7e', '#cbbd9d'].map(hex);
const ROOFS = ['#6d3e2c', '#5b3a2e', '#4a4744', '#7a4a33'].map(hex);
function flatMat(col, tag = 9) {
  return { shade(F) { resetS(); S.wrap = 0.3; const k = 0.9 + 0.15 * tex().at(F.px * 0.3, F.py * 0.3 + F.pz * 0.3); F.tag = tag; shadeLit(F, col[0] * k, col[1] * k, col[2] * k); } };
}
function quad(a, b, c, d) {
  return gridSurface(1, 1, (u, v) => vlerp(vlerp(a, b, u), vlerp(d, c, u), v));
}
export function house(rng, c, yaw, w, dpt, h, roofH) {
  const out = [];
  const fr = Frame.fromYaw(c, yaw);
  const g = c[1];
  const P = (x, y, z) => fr.p(x, y, z);
  const wall = rng.pick(WALLS), roof = rng.pick(ROOFS);
  const hw = w / 2, hd = dpt / 2;
  // walls (4 quads) + gables
  const faces = [
    [P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, h, -hd), P(-hw, h, -hd)],
    [P(hw, 0, hd), P(-hw, 0, hd), P(-hw, h, hd), P(hw, h, hd)],
    [P(-hw, 0, hd), P(-hw, 0, -hd), P(-hw, h, -hd), P(-hw, h, hd)],
    [P(hw, 0, -hd), P(hw, 0, hd), P(hw, h, hd), P(hw, h, -hd)],
  ];
  for (const f of faces) { const m = quad(...f); m.material = flatMat(wall); out.push(m); }
  for (const z of [-hd, hd]) {
    const m = gridSurface(1, 1, (u, v) => vlerp(vlerp(P(-hw, h, z), P(hw, h, z), u), P(0, h + roofH, z), v));
    m.material = flatMat(wall); out.push(m);
  }
  const o = 0.3;
  for (const sgn of [-1, 1]) {
    const m = quad(P(sgn * (hw + o), h - 0.2, -hd - o), P(sgn * (hw + o), h - 0.2, hd + o), P(0, h + roofH, hd + o), P(0, h + roofH, -hd - o));
    m.material = flatMat(roof); out.push(m);
  }
  return out;
}
export function church(rng, c, yaw) {
  const out = house(rng, c, yaw, 7, 18, 7, 4.5);
  const fr = Frame.fromYaw(c, yaw);
  const t = fr.p(0, 0, -11);
  const tower = superBox(Frame.fromYaw([t[0], c[1] + 9, t[2]], yaw), 2.6, 9, 2.6, 8, { nu: 12, nv: 6 });
  tower.material = flatMat(hex('#b3a78c'));
  out.push(tower);
  const sp = limb([t[0], c[1] + 17.5, t[2]], [t[0], c[1] + 30, t[2]], [1, 0, 0], (tt) => { const r = 2.5 * (1 - tt); return [r, r]; }, { nu: 8, nv: 3 });
  sp.material = flatMat(hex('#3f3d3c'));
  out.push(sp);
  return out;
}

const STRAW = hex('#a58c55');
export function haystack(rng, c, r) {
  const fr = Frame.fromYaw(c, rng.range(0, 6));
  const m = ellipsoid(fr.at(add(c, [0, r * 0.45, 0])), r, r * 1.05, r, { nu: 14, nv: 10, deform: (p) => [p[0] * (1 - Math.max(0, p[1]) / r * 0.45), Math.max(p[1], -r * 0.45), p[2] * (1 - Math.max(0, p[1]) / r * 0.45)] });
  m.material = { shade(F) { resetS(); S.wrap = 0.35; const k = 0.8 + 0.3 * tex().at(F.px * 2, F.py * 5); perturb(F, 0, tex().at(F.px * 4, F.py * 9) * 0.5, 1); F.tag = 9; shadeLit(F, STRAW[0] * k, STRAW[1] * k, STRAW[2] * k); } };
  return [m];
}

const WOOD = hex('#5a4632');
export function cart(rng, c, yaw, tipped = 0) {
  const out = [];
  let fr = Frame.fromYaw(c, yaw);
  if (tipped) fr = fr.roll(tipped);
  const body = superBox(fr.at(fr.p(0, 0.95, 0)), 0.75, 0.28, 1.3, 7, { nu: 12, nv: 8 });
  body.material = flatMat(WOOD);
  out.push(body);
  for (const sgn of [-1, 1]) {
    const wc = fr.p(sgn * 0.85, 0.65, -0.1);
    const wf = Frame.fromUpFwd(wc, fr.x, fr.z);
    const wheel = gridSurface(20, 3, (u, v) => {
      const th = u * Math.PI * 2;
      const r = 0.65 - (v < 0.5 ? 0 : 0.08);
      return wf.p(Math.cos(th) * r, (v - 0.5) * 0.1, Math.sin(th) * r);
    }, { wrapU: true });
    wheel.material = flatMat(hex('#4a3a2a'));
    out.push(wheel);
  }
  for (const sgn of [-1, 1]) {
    const sh = limb(fr.p(sgn * 0.5, 0.9, 1.2), fr.p(sgn * 0.45, 0.3, 3.2), fr.x, () => [0.05, 0.05], { nu: 5, nv: 2 });
    sh.material = flatMat(WOOD);
    out.push(sh);
  }
  return out;
}

export function fence(rng, pts, { broken = 0.3 } = {}) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    for (const p of [a]) {
      const post = limb([p[0], height(p[0], p[2]) - 0.1, p[2]], [p[0] + rng.gclip(0, 0.08), height(p[0], p[2]) + 1.25, p[2] + rng.gclip(0, 0.08)], [1, 0, 0], () => [0.06, 0.06], { nu: 6, nv: 2 });
      post.material = flatMat(WOOD);
      out.push(post);
    }
    for (const hh of [0.55, 1.05]) {
      if (rng.chance(broken)) {
        // broken rail hanging down
        const pa = [a[0], height(a[0], a[2]) + hh, a[2]];
        const pb = vlerp(pa, [b[0], height(b[0], b[2]) + 0.05, b[2]], rng.range(0.6, 0.9));
        const r = limb(pa, pb, [0, 1, 0], () => [0.045, 0.035], { nu: 5, nv: 2 });
        r.material = flatMat(WOOD); out.push(r);
        continue;
      }
      const r = limb([a[0], height(a[0], a[2]) + hh, a[2]], [b[0], height(b[0], b[2]) + hh, b[2]], [0, 1, 0], () => [0.045, 0.035], { nu: 5, nv: 2 });
      r.material = flatMat(WOOD);
      out.push(r);
    }
  }
  return out;
}

const HIDE = ['#5a4030', '#3a2c22', '#8a7560', '#2c2522'].map(hex);
export function cow(rng, c, yaw) {
  const fr = Frame.fromYaw(c, yaw);
  const col = rng.pick(HIDE);
  const out = [];
  const body = ellipsoid(fr.at(fr.p(0, 1.05, 0)), 0.38, 0.42, 0.95, { nu: 12, nv: 8 });
  body.material = flatMat(col); out.push(body);
  const head = ellipsoid(fr.at(fr.p(0, 1.15, 1.1)).pitch(0.6), 0.16, 0.3, 0.18, { nu: 8, nv: 6 });
  head.material = flatMat(col); out.push(head);
  const ph = rng.range(0, 1);
  for (const [x, z, k] of [[-0.22, 0.65, 0], [0.22, 0.65, 0.5], [-0.22, -0.65, 0.5], [0.22, -0.65, 0]]) {
    const sw = Math.sin((ph + k) * 6.28) * 0.35;
    const lg = limb(fr.p(x, 0.9, z), fr.p(x, 0.02, z + sw), fr.x, () => [0.07, 0.07], { nu: 5, nv: 2 });
    lg.material = flatMat(col); out.push(lg);
  }
  return out;
}

// Wicker basket, overturned, and a pitchfork dropped in the grass
const WICKER = hex('#8c6a3e');
export function basket(c, yaw) {
  const fr = Frame.fromYaw(c, yaw).roll(1.4);
  const m = gridSurface(16, 4, (u, v) => {
    const th = u * Math.PI * 2;
    const r = lerp(0.2, 0.26, v);
    return fr.p(Math.cos(th) * r, v * 0.3, Math.sin(th) * r);
  }, { wrapU: true });
  m.material = { shade(F) { resetS(); S.twoSided = true; const k = 0.7 + 0.3 * Math.abs(Math.sin(F.u * 120 + F.v * 20)); F.tag = 9; shadeLit(F, WICKER[0] * k, WICKER[1] * k, WICKER[2] * k); } };
  return [m];
}
export function pitchfork(p, dir) {
  const d = norm(dir);
  const handle = limb(p, madd(p, d, 1.6), [0, 1, 0], () => [0.017, 0.017], { nu: 6, nv: 2 });
  handle.material = flatMat(hex('#7a6040'));
  const out = [handle];
  const side = norm(cross([0, 1, 0], d));
  for (const k of [-1, 0, 1]) {
    const b = madd(madd(p, d, 1.6), side, k * 0.05);
    const t = limb(b, madd(b, d, 0.3), [0, 1, 0], () => [0.006, 0.006], { nu: 4, nv: 2, capB: 0.005 });
    t.material = flatMat(hex('#3a3a3c'));
    out.push(t);
  }
  return out;
}
