// Flintlock musket, sabre in scabbard, cartridge box, crossbelt plate, belt buckle.
import { Frame, add, sub, mul, madd, norm, cross, dot, len, perp, rotAxis, vlerp, lerp, smoothstep, clamp } from '../core/math.mjs';
import { gridSurface } from '../core/mesh.mjs';
import { limb, ellipsoid, superBox, pipe, ribbon, spow } from './geom.mjs';
import { C, TEX, woodMat, metalMat, leatherMat, whiteLeatherMat, torsoRest, beltDist } from './materials.mjs';
import { S, resetS, shadeLit } from '../core/light.mjs';
import { torsoMap } from './body.mjs';

// ---------------- musket ----------------
// Local frame: origin at butt plate centre-line top (comb heel), z toward muzzle, y = top (barrel side), x = lock side.
export const MUSKET_LEN = 1.52;
// stock profile rows: z, top y, bottom y, half-width
const STOCK = [
  [0.0, -0.028, -0.158, 0.021],
  [0.1, -0.022, -0.13, 0.021],
  [0.22, -0.012, -0.085, 0.02],
  [0.3, -0.004, -0.052, 0.017],
  [0.34, 0.0, -0.04, 0.0155],
  [0.37, 0.004, -0.038, 0.017],
  [0.4, 0.008, -0.042, 0.021],
  [0.5, 0.008, -0.036, 0.0195],
  [0.56, 0.006, -0.03, 0.0165],
  [0.9, 0.004, -0.025, 0.0155],
  [1.25, 0.003, -0.021, 0.0145],
  [1.39, 0.002, -0.019, 0.0135],
];
function stockRow(z) {
  let i = 0;
  while (i < STOCK.length - 2 && STOCK[i + 1][0] < z) i++;
  const a = STOCK[i], b = STOCK[i + 1];
  const k = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

export function buildMusket(fr, lod, { sling = true, slingSag = null, fixed = false, broken = false } = {}) {
  const out = [];
  const nu = Math.max(8, Math.round(20 * lod)), nv = Math.max(10, Math.round(70 * lod));
  const stockEnd = 1.39;
  const stock = gridSurface(nu, nv, (u, v) => {
    const z = v * stockEnd;
    const [t, b, w] = stockRow(z);
    const th = u * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    const q = 2 / 2.6;
    let yc = (t + b) / 2, hh = (t - b) / 2;
    let cap = 1;
    if (v > 0.992) cap = 0.6;
    return fr.p(w * spow(c, q) * cap, yc + hh * spow(s, q) * cap, z);
  }, { wrapU: true });
  stock.material = woodMat();
  out.push(stock);
  // butt plate (brass)
  const bp = gridSurface(8, 2, (u, v) => {
    const z = 0.004 - v * 0.006;
    const [t, b, w] = stockRow(0);
    const th = u * Math.PI * 2;
    return fr.p(w * 1.02 * Math.cos(th) * (1 - v * 0.9), (t + b) / 2 + (t - b) / 2 * 1.01 * Math.sin(th) * (1 - v * 0.9), z);
  }, { wrapU: true });
  bp.material = metalMat(C.brass, { spec: 1.6, shin: 40 });
  out.push(bp);
  // barrel
  const barrel = limb(fr.p(0, 0.011, 0.36), fr.p(0, 0.011, MUSKET_LEN), fr.x, (t) => {
    const r = lerp(0.0145, 0.0112, Math.pow(t, 0.6));
    return [r, r];
  }, { nu: Math.max(6, Math.round(14 * lod)), nv: 4, capA: 0.004, capB: 0 });
  barrel.material = steelMat();
  out.push(barrel);
  // muzzle bore (dark)
  const bore = limb(fr.p(0, 0.011, MUSKET_LEN - 0.001), fr.p(0, 0.011, MUSKET_LEN + 0.0005), fr.x, () => [0.0085, 0.0085], { nu: 10, nv: 1 });
  bore.material = { shade(F) { resetS(); shadeLit(F, 0.005, 0.005, 0.005); } };
  out.push(bore);
  // ramrod under barrel beyond stock
  const rr = limb(fr.p(0, -0.012, 1.2), fr.p(0, -0.009, MUSKET_LEN - 0.02), fr.x, () => [0.0045, 0.0045], { nu: 6, nv: 2, capB: 0.004 });
  rr.material = steelMat();
  out.push(rr);
  // bands (brass)
  for (const [z, wdt] of [[0.86, 0.018], [1.08, 0.016], [1.36, 0.04]]) {
    const [t, b, w] = stockRow(Math.min(z, 1.38));
    const band = gridSurface(Math.max(8, Math.round(16 * lod)), 2, (u, v) => {
      const th = u * Math.PI * 2;
      const zz = z - wdt / 2 + v * wdt;
      const top = 0.011 + 0.0155;
      const yc = (top + b) / 2 - 0.0015, hh = (top - b) / 2 + 0.002;
      return fr.p((w + 0.0022) * Math.cos(th), yc + hh * Math.sin(th), zz);
    }, { wrapU: true });
    band.material = metalMat(C.brass, { spec: 1.8, shin: 50 });
    out.push(band);
  }
  // lock plate + cock + frizzen on the x side
  if (lod > 0.2) {
    const lp = superBox(new Frame(fr.p(0.0205, -0.004, 0.45), fr.x, fr.y, fr.z), 0.003, 0.014, 0.07, 5, { nu: 10, nv: 6 });
    lp.material = steelMat();
    out.push(lp);
    const cock = limb(fr.p(0.026, -0.006, 0.418), fr.p(0.028, 0.03, 0.43), fr.x, () => [0.004, 0.006], { nu: 6, nv: 2, capA: 0.004, capB: 0.006 });
    cock.material = steelMat();
    out.push(cock);
    const friz = limb(fr.p(0.024, 0.008, 0.478), fr.p(0.024, 0.036, 0.472), fr.x, () => [0.0035, 0.008], { nu: 6, nv: 2, capA: 0.003, capB: 0.003 });
    friz.material = steelMat();
    out.push(friz);
    // trigger guard (brass loop)
    const tg = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      tg.push(fr.p(0, -0.04 - Math.sin(Math.PI * t) * 0.024, 0.38 + t * 0.11));
    }
    const guard = pipe(tg, () => 0.0035, { nu: 6, perSeg: 1 });
    guard.material = metalMat(C.brass, { spec: 1.6, shin: 40 });
    out.push(guard);
  }
  // sling: buff leather strap from middle band to the butt underside
  if (sling && lod > 0.18) {
    const A = fr.p(0, -0.03, 1.07), B = fr.p(0, -0.1, 0.18);
    const sag = slingSag || [0, -1, 0];
    const L = len(sub(A, B));
    const pts = [], wd = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      let p = vlerp(A, B, t);
      p = madd(p, sag, Math.sin(Math.PI * t) * L * 0.09);
      pts.push(p);
      wd.push(fr.x);
    }
    const sl = ribbon(pts, wd, 0.032, { nu: 1 });
    sl.material = { shade(F) { resetS(); S.twoSided = true; S.wrap = 0.3; S.spec = 0.1; F.tag = 2; shadeLit(F, C.leather[0] * 0.95, C.leather[1] * 0.93, C.leather[2] * 0.88); } };
    out.push(sl);
  }
  return out;
}

function steelMat() {
  return {
    shade(F) {
      resetS();
      S.spec = 2.4; S.shin = 80; S.specTint = 0.3; S.wrap = 0.1; S.sheen = 0.4;
      const n = 1 + 0.15 * TEX.fine.at(F.px * 3 + F.pz, F.py * 3);
      F.tag = 4;
      shadeLit(F, C.steel[0] * n, C.steel[1] * n, C.steel[2] * n);
    },
  };
}

// Musket frame helpers
export function musketFrame(butt, dir, topHint) {
  const z = norm(dir);
  const y = norm(perp(topHint, z));
  return new Frame(butt, cross(y, z), y, z);
}
// point along musket axis at distance d from butt (barrel centre-line)
export function musketAxis(fr, d) {
  return fr.p(0, -0.012, d);
}

// ---------------- sabre, cartridge box, plates ----------------
function beltSurfacePoint(sk, which, frontness, yTarget) {
  // search a point on the torso rest surface on belt 'which' near height yTarget with given side
  let best = null, bd = 1e9;
  for (let i = 0; i < 64; i++) {
    const u = i / 64;
    for (let j = 0; j < 40; j++) {
      const v = j / 40;
      const p = torsoRest(u, v, sk.body);
      const dd = Math.abs(beltDist(p, which)) * 10 + Math.abs(p[1] - yTarget) + (frontness(p) ? 0 : 5);
      if (dd < bd) { bd = dd; best = p; }
    }
  }
  return best;
}

export function buildEquipment(sk, att, lod) {
  const s = sk.s;
  const out = [];
  const P = sk.pelvis;
  if (!att.officer) {
    // crossbelt plate at the crossing on the chest (brass oval)
    const pc = torsoMap(sk, [0, 1.215, 0.135]);
    const n = norm(sub(torsoMap(sk, [0, 1.215, 0.2]), torsoMap(sk, [0, 1.215, 0.0])));
    const pf = Frame.fromFwdUp(madd(pc, n, 0.0015 * s), n, sk.chest.y);
    const plate = ellipsoid(pf, 0.03 * s, 0.022 * s, 0.004 * s, { nu: 16, nv: 8 });
    plate.material = metalMat(C.brass, { spec: 2, shin: 55 });
    out.push(plate);
    // cartridge box on the right hip behind
    const bx = torsoMap(sk, [0.15, 0.935, -0.09]);
    const bfr = Frame.fromFwdUp(bx, sk.pelvis.x, sk.pelvis.y).yaw(-0.5).at(madd(madd(bx, sk.pelvis.x, 0.03 * s), sk.pelvis.z, -0.03 * s));
    let bf = bfr;
    if (att.boxSwing) bf = bfr.rot(att.boxSwing.axis, att.boxSwing.angle);
    const box = superBox(bf, 0.04 * s, 0.075 * s, 0.11 * s, 6, { nu: 16, nv: 10 });
    box.material = leatherMat(C.blackLeather, { spec: 0.9, shin: 30 });
    out.push(box);
    const badge = ellipsoid(bf.at(bf.p(0.042 * s, 0.01 * s, 0)), 0.003 * s, 0.028 * s, 0.03 * s, { nu: 10, nv: 6 });
    badge.material = metalMat(C.brass, { spec: 2, shin: 50 });
    out.push(badge);
  }
  // waist-belt buckle plate (front)
  {
    const pc = torsoMap(sk, [0, 1.044, 0.112]);
    const n = norm(sub(torsoMap(sk, [0, 1.044, 0.2]), torsoMap(sk, [0, 1.044, 0])));
    const pf = Frame.fromFwdUp(madd(pc, n, 0.004 * s), n, sk.lumbar.y);
    const plate = superBox(pf, 0.034 * s, 0.026 * s, 0.004 * s, 5, { nu: 12, nv: 8 });
    plate.material = metalMat(att.officer ? C.silver : C.brass, { spec: 2, shin: 55 });
    out.push(plate);
  }
  // sabre on the left hip
  if (att.sabre !== false) {
    const hp = torsoMap(sk, [-0.165, 0.99, 0.02]);
    const down = sk.pelvis.y, back = mul(sk.pelvis.z, -1);
    // scabbard hangs back-down at ~50 deg, swinging slightly
    let dir = norm(add(mul(down, -0.9), mul(back, 0.42)));
    if (att.sabreSwing) dir = norm(add(dir, att.sabreSwing));
    const side = mul(sk.pelvis.x, -1);
    const top = madd(madd(hp, side, 0.03 * s), dir, 0.02 * s);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      let p = madd(top, dir, t * 0.47 * s);
      p = madd(p, sk.pelvis.z, -t * t * 0.08 * s); // curve backward
      pts.push(p);
    }
    const scab = pipe(pts, (t) => (0.0135 - t * 0.004) * s, { nu: 8, perSeg: 1, ref: side });
    scab.material = leatherMat(C.blackLeather, { spec: 1, shin: 30 });
    out.push(scab);
    // chape (brass tip)
    const tip = pts[pts.length - 1];
    const ch = limb(vlerp(pts[pts.length - 2], tip, 0.5), tip, side, () => [0.0095 * s, 0.009 * s], { nu: 8, nv: 2, capB: 0.008 * s });
    ch.material = metalMat(C.brass, { spec: 1.8, shin: 45 });
    out.push(ch);
    // hilt: grip forward-up + guard
    const hdir = mul(dir, -1);
    const g0 = madd(top, hdir, 0.005 * s), g1 = madd(g0, norm(add(hdir, mul(sk.pelvis.z, 0.35))), 0.1 * s);
    const grip = limb(g0, g1, side, () => [0.009 * s, 0.011 * s], { nu: 8, nv: 3, capB: 0.01 * s });
    grip.material = metalMat([C.brass[0] * 0.7, C.brass[1] * 0.7, C.brass[2] * 0.7], { spec: 1.0, shin: 30 });
    out.push(grip);
    // sword knot (white tassel)
    const kn0 = madd(g1, sk.pelvis.y, -0.01 * s);
    const kn1 = madd(madd(kn0, sk.pelvis.y, -0.12 * s), sk.pelvis.z, 0.02 * s);
    const knot = limb(kn0, kn1, side, (t) => {
      const r = (t < 0.6 ? 0.005 : lerp(0.006, 0.015, (t - 0.6) / 0.4)) * s;
      return [r, r];
    }, { nu: 8, nv: 4, capB: 0.006 * s });
    knot.material = { shade(F) { resetS(); S.wrap = 0.35; const k = 0.75 + 0.25 * Math.sin(F.u * 6.28 * 14); F.tag = 6; shadeLit(F, C.cord[0] * k, C.cord[1] * k, C.cord[2] * k); } };
    out.push(knot);
  }
  return out;
}

// Officer's drawn sword: grip in the hand, blade along dir.
export function buildSword(handFr, dir, s, lod) {
  const out = [];
  const d = norm(dir);
  const g = madd(madd(handFr.o, handFr.z, 0.075 * s), handFr.y, -0.03 * s);
  const side = norm(perp(handFr.y, d));
  // grip + pommel
  const gA = madd(g, d, -0.07 * s), gB = madd(g, d, 0.05 * s);
  const grip = limb(gA, gB, side, () => [0.013 * s, 0.015 * s], { nu: 8, nv: 2, capA: 0.016 * s });
  grip.material = metalMat(C.brass, { spec: 1.6, shin: 40 });
  out.push(grip);
  // guard (crossbar + knuckle bow)
  const guard = limb(madd(gB, side, -0.045 * s), madd(gB, side, 0.045 * s), d, () => [0.007 * s, 0.005 * s], { nu: 6, nv: 2, capA: 0.006 * s, capB: 0.006 * s });
  guard.material = metalMat(C.brass, { spec: 1.6, shin: 40 });
  out.push(guard);
  // blade: flat, slightly curved, tapering
  const L = 0.82 * s;
  const n = norm(cross(d, side));
  const bl = gridSurface(4, Math.max(8, Math.round(24 * lod)), (u, v) => {
    const t = v;
    const w = lerp(0.016, 0.004, Math.pow(t, 1.5)) * s * (t > 0.96 ? (1 - t) / 0.04 : 1);
    const th = u * Math.PI * 2;
    let p = madd(gB, d, t * L);
    p = madd(p, n, t * t * 0.05 * s);
    p = madd(p, side, Math.cos(th) * w);
    p = madd(p, n, Math.sin(th) * 0.0025 * s);
    return p;
  }, { wrapU: true });
  bl.material = metalMat([0.55, 0.57, 0.6], { spec: 3, shin: 120, tint: 0.2 });
  out.push(bl);
  // sword knot
  const kn = limb(gA, madd(madd(gA, [0, -1, 0], 0.1 * s), d, -0.02 * s), side, (t) => {
    const r = (t < 0.6 ? 0.005 : lerp(0.006, 0.014, (t - 0.6) / 0.4)) * s;
    return [r, r];
  }, { nu: 8, nv: 3, capB: 0.006 * s });
  kn.material = metalMat(C.silver, { spec: 1.0, shin: 25, tint: 0.3 });
  out.push(kn);
  return out;
}

// Gorget (officer's silver crescent at the throat)
export function buildGorget(sk, s) {
  const c = sk.chest;
  const g = gridSurface(14, 3, (u, v) => {
    const th = lerp(-1.1, 1.1, u);
    const r = (0.07 + v * 0.04) * s;
    return c.p(Math.sin(th) * r, (0.2 - v * 0.035) * s, (0.07 + Math.cos(th) * 0.045 + v * 0.015) * s);
  });
  g.material = metalMat(C.silver, { spec: 2.5, shin: 70, tint: 0.5 });
  return g;
}
