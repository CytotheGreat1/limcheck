// Head, face, ears, bearskin (with plate, stag insignia, cords, tassels) and plume.
import { Frame, add, sub, mul, madd, norm, cross, dot, len, perp, rotAxis, vlerp, lerp, smoothstep, clamp, hex } from '../core/math.mjs';
import { gridSurface } from '../core/mesh.mjs';
import { limb, ellipsoid, pipe, spow } from './geom.mjs';
import { C, TEX } from './materials.mjs';
import { S, resetS, shadeLit, perturb } from '../core/light.mjs';
import { noise2, noise3 } from '../core/rng.mjs';

// ---------------- face shape ----------------
// rows: y, X half-width, Zf, Zb, zc
const HEAD = [
  [-0.121, 0.008, 0.012, 0.012, 0.062],
  [-0.115, 0.026, 0.026, 0.03, 0.05],
  [-0.106, 0.04, 0.04, 0.043, 0.04],
  [-0.094, 0.051, 0.053, 0.052, 0.032],
  [-0.079, 0.059, 0.064, 0.06, 0.025],
  [-0.06, 0.065, 0.076, 0.075, 0.016],
  [-0.035, 0.069, 0.085, 0.088, 0.007],
  [-0.01, 0.074, 0.091, 0.094, 0.0],
  [0.02, 0.077, 0.093, 0.1, -0.002],
  [0.05, 0.078, 0.097, 0.1, -0.004],
  [0.08, 0.074, 0.093, 0.095, -0.006],
  [0.105, 0.06, 0.075, 0.08, -0.008],
  [0.12, 0.035, 0.045, 0.05, -0.01],
  [0.128, 0.004, 0.004, 0.004, -0.01],
];
const HY0 = HEAD[0][0], HY1 = HEAD[HEAD.length - 1][0];

function headRow(y) {
  let i = 0;
  while (i < HEAD.length - 2 && HEAD[i + 1][0] < y) i++;
  const a = HEAD[i], b = HEAD[i + 1];
  let k = clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
  k = k * k * (3 - 2 * k) * 0.6 + k * 0.4;
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + (b[4] - a[4]) * k];
}

const g2 = (dx, dy, r) => Math.exp(-(dx * dx + dy * dy) / (r * r));

// Facial relief (added along +z for frontal points).
function relief(x, y, fc, ex) {
  const ax = Math.abs(x);
  let d = 0;
  // nose
  const nl = fc.nose; // length factor
  const top = 0.024, tipY = -0.02 * nl + 0.002;
  if (y < top && y > tipY - 0.02) {
    let prot;
    if (y >= tipY) {
      const t = (top - y) / (top - tipY);
      prot = 0.021 * fc.noseP * Math.pow(t, 1.25) + fc.hump * 0.004 * Math.sin(Math.PI * clamp(t * 1.3, 0, 1)) - 0.003 * g2(0, y - 0.027, 0.006);
    } else {
      const t = (tipY - y) / 0.016;
      prot = 0.021 * fc.noseP * (1 - smoothstep(0, 1, t)) * 0.95 + 0.005 * (1 - t);
    }
    const t2 = clamp((top - y) / (top - tipY), 0, 1.2);
    const wN = (0.009 + 0.011 * t2) * fc.noseW;
    d += Math.max(0, prot) * Math.exp(-(x * x) / (wN * wN));
    // wings
    d += 0.007 * fc.noseW * g2(ax - 0.0135 * fc.noseW, y - (tipY - 0.006), 0.0075);
  }
  // brow ridge
  const browY = 0.035 - ex.brow * 0.003 + (ex.brow < 0 ? Math.max(0, 0.02 - ax) * ex.brow * -0.15 : 0);
  d += fc.brow * 0.0065 * Math.exp(-((y - browY) * (y - browY)) / 0.00011) * (1 - smoothstep(0.045, 0.065, ax));
  // eye sockets and globes
  d -= 0.012 * g2(ax - 0.033, y - 0.02, 0.016);
  d += 0.0045 * g2(ax - 0.033, y - 0.0165, 0.0105);
  // cheekbones
  d += fc.cheek * 0.006 * g2(ax - 0.047, y + 0.004, 0.022);
  // hollow cheeks for older / gaunt
  d -= fc.gaunt * 0.006 * g2(ax - 0.045, y + 0.045, 0.018);
  // lips
  const mw = 0.024 * (1 + ex.wide * 0.25);
  const lipMask = 1 - smoothstep(mw * 0.7, mw, ax);
  d += 0.0045 * fc.lips * g2(0, y + 0.049, 0.008) * lipMask;
  d += 0.0045 * fc.lips * g2(0, y + 0.066 + ex.jaw * 0.016, 0.0075) * lipMask;
  // philtrum dip
  d -= 0.0015 * g2(x, y + 0.042, 0.004);
  // chin
  d += fc.chin * 0.007 * g2(x * 0.7, y + 0.095, 0.017);
  // mentolabial groove
  d -= 0.003 * g2(x * 0.5, y + 0.078 + ex.jaw * 0.012, 0.006);
  return d;
}

// rest point on the head surface from params. Returns [x,y,z]
export function headRest(u, v, fc, ex) {
  let y = HY0 + (HY1 - HY0) * v;
  const [X, Zf, Zb, zc] = headRow(y);
  const th = u * Math.PI * 2;
  const c = Math.cos(th), s = Math.sin(th);
  const q = s > 0 ? 1 : 2 / 2.2;
  let x = X * fc.width * spow(c, q) * (y < -0.05 ? lerp(1, fc.jaw, smoothstep(-0.05, -0.09, y)) : 1);
  let z = zc + (s > 0 ? Zf : Zb) * spow(s, q);
  if (s > 0) {
    // flatten the face front slightly (cheeks forward) without losing roundness
    z += 0.008 * Math.pow(s, 6) * (1 - smoothstep(-0.1, -0.07, -Math.abs(y + 0.01)));
    const fr = Math.pow(s, 3);
    z += relief(x, y, fc, ex) * fr;
  }
  // jaw drop
  if (ex.jaw > 0 && y < -0.052) {
    const k = smoothstep(-0.052, -0.07, y) * smoothstep(-0.03, 0.03, z);
    y -= ex.jaw * 0.02 * k;
    z -= ex.jaw * 0.006 * k;
  }
  // compress the lower face toward natural proportions
  if (y < 0) y *= 0.84;
  return [x, y, z];
}

function faceMat(fc, ex, tone) {
  const hair = fc.hair;
  return {
    shade(F) {
      resetS();
      S.wrap = 0.45; S.spec = 0.16; S.shin = 16; S.sheen = 0.04;
      const u = F.u, v = F.v;
      const y = HY0 + (HY1 - HY0) * v;
      const [X, Zf, Zb, zc] = headRow(y);
      const th = u * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const qq = s > 0 ? 1 : 2 / 2.2;
      const x = X * fc.width * spow(c, qq);
      const z = zc + (s > 0 ? Zf : Zb) * spow(s, qq);
      const ax = Math.abs(x);
      const n = TEX.a.at(u * 3.3, v * 2.1) * 0.5 + TEX.fine.at(u * 2, v * 2) * 0.5;
      let r = tone[0], g = tone[1], b = tone[2];
      // tan / ruddiness
      const red = fc.ruddy * (0.7 * g2(ax - 0.045, y + 0.012, 0.026) + 0.6 * g2(x, y + 0.02, 0.013) + 0.35 * smoothstep(0.06, 0.075, ax));
      r *= 1 + red * 0.3; g *= 1 - red * 0.12; b *= 1 - red * 0.12;
      // cool half-tones at temples/jaw, darker eye sockets
      const cool = 0.5 * g2(ax - 0.06, y + 0.06, 0.03) + 0.4 * g2(ax - 0.062, y - 0.03, 0.02);
      r *= 1 - cool * 0.12; g *= 1 - cool * 0.06; b *= 1 + cool * 0.02;
      const sock = g2(ax - 0.034, y - 0.019, 0.015) * 0.34;
      r *= 1 - sock; g *= 1 - sock * 1.1; b *= 1 - sock * 1.05;
      r *= 1 + n * 0.06; g *= 1 + n * 0.05; b *= 1 + n * 0.05;
      // stubble / beard shadow on jaw and upper lip
      const beardZone = smoothstep(-0.03, -0.055, y) * smoothstep(-0.02, 0.03, z) + g2(x * 0.6, y + 0.043, 0.009) * 0.6;
      const stub = fc.stubble * clamp(beardZone, 0, 1) * (0.8 + 0.2 * TEX.fine.at(u * 12, v * 12));
      r *= 1 - stub * 0.28; g *= 1 - stub * 0.26; b *= 1 - stub * 0.18;
      // gunpowder grime around mouth (from biting cartridges)
      const grime = fc.grime * g2(x * 0.7, y + 0.06, 0.02) * (0.6 + 0.4 * TEX.b.at(u * 5, v * 5));
      r *= 1 - grime * 0.45; g *= 1 - grime * 0.45; b *= 1 - grime * 0.42;
      let isHair = 0;
      const hn0 = TEX.fine.at(u * 23, v * 19) * 0.5 + TEX.fine.at(u * 61, v * 47) * 0.5;
      // sideburns in front of the ears: soft-edged patch following the cheek
      const sbLen = fc.sideburn; // 0..1
      if (ax > 0.045 && s > -0.5) {
        const yb = 0.03 - 0.07 * sbLen; // bottom of sideburn
        const zf = 0.028 + 0.012 * sbLen - (0.03 - y) * 0.15;
        const inY = smoothstep(yb - 0.004, yb + 0.006, y + hn0 * 0.004);
        const inZ = 1 - smoothstep(zf - 0.006, zf + 0.004, z + hn0 * 0.003);
        const inB = smoothstep(-0.02, -0.01, z);
        isHair = Math.max(isHair, inY * inZ * inB * (y < 0.06 ? 1 : 0) * 0.92);
      }
      // cropped hair over the crown and temples (seen when the bearskin is lost)
      if (y > 0.04 - (z < 0 ? 0.08 : 0) + (z > 0.05 ? 0.03 : 0)) isHair = Math.max(isHair, smoothstep(0.035, 0.05, y + hn0 * 0.006 + (z < 0 ? 0.08 : 0)));
      // nape hair under the bearskin
      if (z < -0.02) isHair = Math.max(isHair, smoothstep(-0.05, -0.035, y + hn0 * 0.008) * smoothstep(-0.02, -0.045, z) * 0.9);
      // moustache
      if (fc.moustache > 0 && z > 0.06) {
        const mh = 0.01 * fc.moustache;
        const ends = fc.droop * smoothstep(0.01, 0.03, ax) * 0.01;
        const top = -0.0355 - ax * 0.1, bot = -0.0465 - mh * 0.5 - ends;
        const wm = 0.02 + 0.011 * fc.moustache;
        const m = smoothstep(bot - 0.0015, bot + 0.0015, y + hn0 * 0.0015) * (1 - smoothstep(top - 0.0015, top + 0.001, y)) * (1 - smoothstep(wm - 0.004, wm, ax));
        isHair = Math.max(isHair, m * 0.95);
      }
      // eyebrows
      const browY = 0.033 - ex.brow * 0.002 + (ex.brow < 0 ? (0.05 - ax) * -ex.brow * 0.12 : 0) + (ax - 0.03) * (ax - 0.03) * -3;
      if (z > 0.05 && ax > 0.009 && ax < 0.055 && Math.abs(y - browY) < 0.0045 * fc.browThick * (1 - smoothstep(0.03, 0.055, ax) * 0.5)) isHair = 0.95;
      if (isHair) {
        // strand texture: streaks running back over the skull
        const strands = TEX.fine.at(u * 30, v * 3) * 0.6 + hn0 * 0.4;
        if (y > 0.04) perturb(F, strands * 0.4, 0, 1);
        const hn = 0.65 + 0.7 * (0.5 + 0.5 * strands);
        r = r * (1 - isHair) + hair[0] * hn * isHair;
        g = g * (1 - isHair) + hair[1] * hn * isHair;
        b = b * (1 - isHair) + hair[2] * hn * isHair;
        S.spec = 0.25; S.shin = 20;
      }
      // eyes
      if (z > 0.055) {
        const open = ex.eyes;
        const ecx = 0.033, ecy = 0.0165;
        const dx = (ax - ecx) / 0.0135;
        const upper = 0.0048 * open, lower = 0.003 * open;
        const dy = y - ecy;
        const lim = 1 - dx * dx;
        if (lim > 0) {
          const sq = Math.sqrt(lim);
          const topE = upper * sq, botE = -lower * sq;
          if (dy < topE + 0.0016 && dy > topE - 0.0004 && open > 0.08) {
            // upper lid / lashes
            r = hair[0] * 0.6 + tone[0] * 0.15; g = hair[1] * 0.6 + tone[1] * 0.15; b = hair[2] * 0.6 + tone[2] * 0.15;
          } else if (dy < topE && dy > botE) {
            // sclera + iris
            const gx = (x < 0 ? -1 : 1) * 0 + ex.gazeX * 0.004;
            const ix = x - (x < 0 ? -ecx : ecx) - ex.gazeX * 0.0045;
            const iy = dy - ex.gazeY * 0.003;
            const ir = Math.hypot(ix, iy);
            if (ir < 0.0048) {
              const k = ir < 0.002 ? 0.15 : 1;
              r = fc.iris[0] * k; g = fc.iris[1] * k; b = fc.iris[2] * k;
              S.spec = 1.4; S.shin = 90;
            } else {
              r = 0.34; g = 0.3; b = 0.27;
              S.spec = 0.9; S.shin = 60;
            }
            // shadow of upper lid
            const sh = smoothstep(topE - 0.0035, topE, dy);
            r *= 1 - sh * 0.6; g *= 1 - sh * 0.6; b *= 1 - sh * 0.6;
          } else if (dy > topE && dy < topE + 0.006) {
            // lid crease shading
            const k = 1 - 0.18 * (1 - (dy - topE) / 0.006);
            r *= k; g *= k * 0.97; b *= k * 0.97;
          }
        }
        // crow's feet / under-eye for older men
        if (fc.age > 0.4) {
          const ue = g2(ax - 0.033, y - 0.006, 0.008) * (fc.age - 0.4) * 0.35;
          r *= 1 - ue; g *= 1 - ue * 1.1; b *= 1 - ue * 0.9;
        }
      }
      // nasolabial folds
      if (z > 0.06) {
        const nlx = 0.02 + (-0.03 - y) * 0.25;
        const fold = fc.age * 0.22 * g2(ax - nlx, 0, 0.0025) * smoothstep(-0.02, -0.03, y) * smoothstep(-0.075, -0.06, y);
        r *= 1 - fold; g *= 1 - fold; b *= 1 - fold;
      }
      // nostrils
      const tipY = -0.022 * fc.nose + 0.002;
      const ns = g2((ax - 0.009) * 1.1, y - (tipY - 0.011), 0.0036);
      if (ns > 0.4) { const k = 1 - (ns - 0.4) * 1.3; r *= k; g *= k; b *= k; }
      // lips and mouth
      const mw = 0.023 * (1 + ex.wide * 0.25);
      if (z > 0.06 && ax < mw) {
        const edge = 1 - smoothstep(mw * 0.6, mw, ax);
        const upperLip = y < -0.046 && y > -0.057 - ex.jaw * 0.002;
        const lowerLip = y < -0.059 - ex.jaw * 0.016 && y > -0.071 - ex.jaw * 0.018;
        if ((upperLip || lowerLip) && !isHair) {
          const k = 0.6 * edge;
          r = r * (1 - k) + fc.lipCol[0] * k; g = g * (1 - k) + fc.lipCol[1] * k; b = b * (1 - k) + fc.lipCol[2] * k;
          S.spec = 0.35; S.shin = 25;
        }
        const openTop = -0.0568, openBot = -0.0582 - ex.jaw * 0.016;
        if (y < openTop && y > openBot) {
          // mouth line / cavity
          const depth = ex.jaw > 0.1 ? 1 : 0.7;
          let rr = 0.06, gg = 0.025, bb = 0.022;
          if (ex.jaw > 0.35 && y > openTop - 0.004 && ax < mw * 0.7) { rr = 0.36; gg = 0.32; bb = 0.27; } // teeth
          const k = depth * (0.5 + 0.5 * edge);
          r = r * (1 - k) + rr * k; g = g * (1 - k) + gg * k; b = b * (1 - k) + bb * k;
          S.spec = 0.1;
        }
      }
      // wound/pallor
      if (fc.pale) { const k = fc.pale; r = lerp(r, r * 0.8 + 0.03, k); g = lerp(g, g * 0.85 + 0.03, k); b = lerp(b, b * 0.9 + 0.035, k); }
      F.tag = 5;
      // occlusion under brim and in sockets
      S.ao = 1 - 0.45 * g2(ax - 0.033, y - 0.018, 0.016) - 0.4 * smoothstep(0.015, 0.045, y) - 0.2 * smoothstep(-0.07, -0.1, y);
      shadeLit(F, r, g, b);
    },
  };
}

// ---------------- bearskin ----------------
// Surface parameterisation in the bearskin frame (origin at base centre; y up; z front).
const BS_H = 0.31;
function bsProfile(h) {
  // half width, front depth, back depth for normalised height h
  let w = 0.091 + 0.022 * Math.sin(Math.min(1, h / 0.7) * Math.PI * 0.5) + 0.004 * h;
  let k = 1;
  if (h > 0.62) k = Math.sqrt(Math.max(0, 1 - Math.pow((h - 0.62) / 0.38, 2)));
  return [w * k, (w + 0.024) * k, (w + 0.026) * k];
}
function bsBaseY(th) {
  // base ring height relative to frame: lower at back
  const s = Math.sin(th); // +1 front
  return s > 0 ? 0.0 : s * 0.05;
}
export function bearskinPoint(u, v, fur, plateFn) {
  const th = u * Math.PI * 2;
  const s = Math.sin(th), c = Math.cos(th);
  const h = v;
  const [w, df, db] = bsProfile(h);
  let base = bsBaseY(th) * (1 - h);
  const y = base + h * BS_H;
  let x = w * c, z = (s > 0 ? df : db) * s - 0.004;
  // fur displacement
  let d = 0;
  if (fur > 0) {
    const plate = plateFn ? plateFn(th, h) : 0;
    const lump = noise3(c * 3.2 + 11, h * 3.2, s * 3.2) * 0.0025 + noise3(c * 9, h * 5.5, s * 9) * 0.0012;
    const fine = noise3(c * 34, h * 9, s * 34) * 0.0045 + noise3(c * 80, h * 16, s * 80) * 0.004 + noise3(c * 170, h * 30, s * 170) * 0.003;
    d = (lump + fine * fur) * (1 - plate) + plate * 0.0025;
    if (h > 0.97) d *= (1 - h) / 0.03;
  }
  const nr = Math.hypot(x, z) || 1;
  return [x + (x / nr) * d, y + d * Math.max(0, h - 0.75) * 2, z + (z / nr) * d];
}

// plate + stag emblem mask in (theta, h)
function frontCoords(th, h) {
  // lateral metres around the front & height metres
  const a = (th - Math.PI / 2) * 0.1;
  const y = h * BS_H;
  return [a, y];
}
function segD(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
export function plateMask(th, h) {
  let dth = th - Math.PI / 2;
  dth = Math.atan2(Math.sin(dth), Math.cos(dth));
  if (Math.abs(dth) > 1.05) return 0;
  const a = dth * 0.1, y = h * BS_H;
  // lower band with arched centre
  const top = 0.022 + 0.022 * Math.pow(Math.max(0, 1 - Math.abs(a) / 0.06), 1.5);
  if (y < top && Math.abs(dth) < 0.9) return 1;
  // stag emblem
  if (stag(a * 1.15, (y - 0.084) * 1.15)) return 1;
  return 0;
}
function stag(a, y) {
  const ax = Math.abs(a);
  if (Math.abs(y) > 0.06 || ax > 0.045) return false;
  // head (muzzle down)
  const hx = a / 0.0095, hy = (y + 0.005) / 0.017;
  if (hx * hx + hy * hy < 1) return true;
  // ears
  if (segD(ax, y, 0.006, 0.008, 0.018, 0.016) < 0.0028) return true;
  // antlers: main beam + tines
  const t = 0.0024;
  if (segD(ax, y, 0.005, 0.012, 0.016, 0.03) < t) return true;
  if (segD(ax, y, 0.016, 0.03, 0.03, 0.043) < t) return true;
  if (segD(ax, y, 0.03, 0.043, 0.041, 0.052) < t * 0.85) return true;
  if (segD(ax, y, 0.012, 0.024, 0.006, 0.038) < t * 0.85) return true;
  if (segD(ax, y, 0.021, 0.035, 0.018, 0.05) < t * 0.85) return true;
  if (segD(ax, y, 0.03, 0.043, 0.032, 0.058) < t * 0.8) return true;
  if (segD(ax, y, 0.009, 0.017, 0.0, 0.021) < t * 0.7) return true;
  return false;
}

const FUR_HI = [0.42, 0.41, 0.42];
function bearskinMat(officer, up) {
  return {
    up,
    shade(F) {
      resetS();
      const th = F.u * Math.PI * 2, h = F.v;
      const pm = plateMask(th, h);
      if (pm > 0.5) {
        S.spec = 2.0; S.shin = 50; S.specTint = 0.6; S.wrap = 0.1; S.sheen = 0.06;
        const n = 1 + 0.12 * TEX.fine.at(F.u * 8, F.v * 8);
        F.tag = 4;
        const c = officer ? C.brass : C.silver;
        shadeLit(F, c[0] * n * 0.55, c[1] * n * 0.55, c[2] * n * 0.55);
        return;
      }
      // fur: strands flowing downward; Kajiya-Kay strand highlight broken up by clumps
      S.wrap = 0.3; S.sheen = 0.02; S.spec = 0; S.specTint = 0;
      const st = TEX.b.at(F.u * 5, F.v * 0.9) * 0.25 + TEX.fine.at(F.u * 24, F.v * 1.1) * 0.35 + TEX.fine.at(F.u * 70 + 0.3, F.v * 2.2) * 0.4;
      const clump = clamp(0.5 + 0.8 * st, 0, 1);
      const k = 0.75 + 0.5 * clump;
      // strand tangent: frame up projected on the surface, twisted by noise
      const Y = this.up;
      let nx = F.nx, ny = F.ny, nz = F.nz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const dd = Y[0] * nx + Y[1] * ny + Y[2] * nz;
      let tx = Y[0] - nx * dd, ty = Y[1] - ny * dd, tz = Y[2] - nz * dd;
      const tw = TEX.a.at(F.u * 10, F.v * 2.5) * 0.9;
      // twist around n
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      tx += bx * tw; ty += by * tw; tz += bz * tw;
      const tl = Math.hypot(tx, ty, tz) || 1;
      S.tx = tx / tl; S.ty = ty / tl; S.tz = tz / tl;
      S.aniso = 0.05 * (0.1 + clump * clump * 1.5); S.anisoShin = 30; S.anisoCol = FUR_HI;
      F.tag = 7;
      S.ao = 0.65 + 0.35 * clump;
      shadeLit(F, C.fur[0] * k * 1.05, C.fur[1] * k, C.fur[2] * k * 1.08);
    },
  };
}

export function bearskinFrame(sk) {
  const hf = sk.head;
  // sits on the head, tilted slightly back
  const fr = hf.pitch(-0.03);
  return fr.at(hf.p(0, 0.037 * sk.s, -0.006 * sk.s));
}

// Build bearskin + plume + cords. fr: bearskin frame, s: scale. wind: world offset vector at plume tip.
export function buildBearskin(fr, s, lod, { officer = false, wind = [0, 0, 0], plumeTorn = null, cordsHang = null, tasselSide = 1 } = {}) {
  const out = [];
  const nu = Math.max(20, Math.round(150 * lod)), nv = Math.max(10, Math.round(70 * lod));
  const fur = lod > 0.25 ? 1 : 0.4;
  const m = gridSurface(nu, nv, (u, v) => {
    const p = bearskinPoint(u, v, fur, plateMask);
    return fr.p(p[0] * s, p[1] * s, p[2] * s);
  }, { wrapU: true, flip: true });
  m.material = bearskinMat(officer, fr.y);
  out.push(m);
  // under-rim (inside) disc to close the bottom
  const rim = gridSurface(Math.max(12, Math.round(40 * lod)), 2, (u, v) => {
    const p = bearskinPoint(u, 0, 0);
    return fr.p(p[0] * s * (1 - v * 0.9), (p[1] + v * 0.02) * s, p[2] * s * (1 - v * 0.9));
  }, { wrapU: true });
  rim.material = { shade(F) { resetS(); S.twoSided = true; shadeLit(F, 0.01, 0.01, 0.01); } };
  out.push(rim);

  const surf = (th, h, off = 0) => {
    const p = bearskinPoint(th / (Math.PI * 2), h, 0);
    const nr = Math.hypot(p[0], p[2]) || 1;
    return fr.p((p[0] + (p[0] / nr) * off) * s, p[1] * s, (p[2] + (p[2] / nr) * off) * s);
  };
  const cm = cordMatLocal();
  // festoon cords across the front: from left side high to right side low (soldier's left = -x => th = PI)
  if (lod > 0.15) {
    for (let k = 0; k < 2; k++) {
      const pts = [];
      const N = 18;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const th = lerp(Math.PI * 1.02, -0.02, t); // from left (PI) across front (PI/2) to right (0)
        const h = lerp(0.62 - k * 0.1, 0.22 - k * 0.06, t) - 0.12 * Math.sin(Math.PI * t) * (k ? 0.6 : 1);
        pts.push(surf(th, Math.max(0.08, h), 0.012 + 0.004 * k));
      }
      const c = pipe(pts, () => 0.0055 * s, { nu: Math.max(5, Math.round(8 * lod)), perSeg: lod > 0.5 ? 3 : 1 });
      c.material = cm;
      out.push(c);
    }
    // hanging cords and tassels on the soldier's right side
    const attach = surf(tasselSide > 0 ? 0.05 : Math.PI - 0.05, 0.18, 0.012);
    const down = cordsHang || fr.d(0, -1, 0);
    const side = fr.d(tasselSide, 0, 0);
    for (let k = 0; k < 2; k++) {
      const off = fr.d(0, 0, (k - 0.5) * 0.03 * s);
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        let p = madd(attach, down, t * 0.15 * s);
        p = madd(p, side, Math.sin(Math.PI * t) * 0.02 * s + 0.01 * s);
        p = madd(p, off, t);
        pts.push(p);
      }
      const c = pipe(pts, () => 0.005 * s, { nu: 6, perSeg: 1 });
      c.material = cm;
      out.push(c);
      // tassel
      const end = pts[pts.length - 1];
      const tas = limb(end, madd(end, down, 0.065 * s), side, (t) => {
        const r = (t < 0.25 ? lerp(0.006, 0.011, t / 0.25) : lerp(0.011, 0.016, (t - 0.25) / 0.75)) * s;
        return [r, r];
      }, { nu: 10, nv: 4, capA: 0.004 * s, capB: 0.003 * s });
      tas.material = tasselMat();
      out.push(tas);
    }
  }
  // plume on the soldier's left side
  if (plumeTorn !== false) {
    out.push(...buildPlume(fr, s, lod, wind, plumeTorn));
  }
  return out;
}

export function buildPlume(fr, s, lod, wind, torn) {
  const out = [];
  let base, dir0;
  let pf = fr;
  if (torn) {
    pf = torn; // a free frame: origin = plume base, y = along plume
    base = pf.o;
  } else {
    const p = bearskinPoint(0.5, 0.3, 0);
    base = fr.p((p[0] - 0.016) * s, p[1] * s, (p[2] - 0.01) * s);
  }
  const L = 0.38 * s;
  const pts = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let p = madd(base, pf.y, t * L);
    p = madd(p, pf.x, -Math.sin(t * 1.6) * 0.03 * s); // slight outward curve
    p = madd(p, pf.z, -t * t * 0.04 * s);
    p = madd(p, wind, t * t);
    pts.push(p);
  }
  const nu = Math.max(8, Math.round(26 * lod)), nv = Math.max(6, Math.round(34 * lod));
  const n = pts.length - 1;
  const at = (t) => {
    const f = t * n;
    const i = Math.min(n - 1, Math.floor(f));
    return vlerp(pts[i], pts[i + 1], f - i);
  };
  if (lod > 0.3) {
    // soft core
    const core = gridSurface(Math.max(10, Math.round(28 * Math.min(1, lod))), Math.max(12, Math.round(44 * Math.min(1, lod))), (u, v) => {
      const c = at(v);
      const t = norm(sub(at(Math.min(1, v + 0.02)), at(Math.max(0, v - 0.02))));
      const a = norm(perp(pf.x, t)), b = cross(t, a);
      const th = u * Math.PI * 2;
      let r = (v < 0.08 ? lerp(0.01, 0.025, v / 0.08) : v < 0.5 ? lerp(0.025, 0.028, (v - 0.08) / 0.42) : lerp(0.028, 0.004, Math.pow((v - 0.5) / 0.5, 1.2))) * s;
      r *= 1 + 0.3 * noise3(Math.cos(th) * 2, Math.sin(th) * 2, v * 12) + 0.28 * noise3(Math.cos(th) * 6 + 3, Math.sin(th) * 6, v * 40) + 0.18 * noise3(Math.cos(th) * 13, Math.sin(th) * 13 - 2, v * 90);
      return [c[0] + (a[0] * Math.cos(th) + b[0] * Math.sin(th)) * r, c[1] + (a[1] * Math.cos(th) + b[1] * Math.sin(th)) * r, c[2] + (a[2] * Math.cos(th) + b[2] * Math.sin(th)) * r];
    }, { wrapU: true });
    core.material = plumeMatLocal();
    out.push(core);
    // barbs: soft curling strands fanning out from the shaft
    const NB = Math.round(40 + 80 * Math.min(1, lod));
    let seed = 0.1234;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let k = 0; k < NB; k++) {
      const t0 = Math.pow(rnd(), 0.8) * 0.9;
      const th = rnd() * Math.PI * 2;
      const c0 = at(t0);
      const t = norm(sub(at(Math.min(1, t0 + 0.02)), at(Math.max(0, t0 - 0.02))));
      const a = norm(perp(pf.x, t)), b = cross(t, a);
      const out0 = norm(add(mul(a, Math.cos(th)), mul(b, Math.sin(th))));
      const lenB = (0.03 + 0.03 * Math.sin(Math.PI * Math.min(1, t0 * 1.2 + 0.2))) * s * (0.6 + 0.7 * rnd());
      const width = (0.006 + 0.008 * rnd()) * s;
      const curl = 0.4 + rnd() * 0.9, droop = 0.2 + rnd() * 0.5;
      const side2 = norm(cross(out0, t));
      const bp = [], bw = [];
      for (let j = 0; j <= 5; j++) {
        const q = j / 5;
        let p = madd(c0, out0, lenB * (q - curl * 0.25 * q * q * q));
        p = madd(p, t, lenB * (0.75 * q - curl * 0.4 * q * q));
        p = madd(p, [0, -1, 0], lenB * droop * q * q);
        p = madd(p, side2, lenB * 0.3 * (rnd() - 0.5) * q);
        bp.push(p);
        bw.push(norm(add(side2, mul(out0, 0.3 * (rnd() - 0.5)))));
      }
      const rb = gridSurface(2, 5, (u, v) => {
        const f = v * 5;
        const i = Math.min(4, Math.floor(f));
        const p = vlerp(bp[i], bp[i + 1], f - i);
        const w = width * Math.sin(Math.PI * Math.min(1, v * 1.1 + 0.05));
        return madd(p, bw[i], (u - 0.5) * w);
      });
      rb.material = plumeMatLocal();
      out.push(rb);
    }
    return out;
  }
  // plume body (distant LOD)
  const m = gridSurface(nu, nv, (u, v) => {
    const f = v * n;
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    const c = vlerp(pts[i], pts[i + 1], k);
    const t = norm(sub(pts[i + 1], pts[i]));
    const a = norm(perp(pf.x, t)), b = cross(t, a);
    const th = u * Math.PI * 2;
    let r = (v < 0.06 ? lerp(0.008, 0.02, v / 0.06) : v < 0.5 ? lerp(0.02, 0.034, (v - 0.06) / 0.44) : lerp(0.034, 0.003, Math.pow((v - 0.5) / 0.5, 1.4))) * s;
    r *= 1 + 0.35 * noise3(Math.cos(th) * 2 + v * 9, Math.sin(th) * 2, v * 14) + 0.2 * noise3(Math.cos(th) * 6, Math.sin(th) * 6 + v * 30, 3);
    return [c[0] + (a[0] * Math.cos(th) + b[0] * Math.sin(th)) * r, c[1] + (a[1] * Math.cos(th) + b[1] * Math.sin(th)) * r, c[2] + (a[2] * Math.cos(th) + b[2] * Math.sin(th)) * r];
  }, { wrapU: true });
  m.material = plumeMatLocal();
  out.push(m);
  return out;
}

function plumeMatLocal() {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.6; S.trans = 0.45; S.sheen = 0.15; S.twoSided = true;
      const barb = 0.8 + 0.2 * (0.5 + 0.5 * TEX.fine.at(F.u * 6 + F.px * 9, F.v * 9 + F.py * 9));
      F.tag = 6;
      S.ao = 0.8 + 0.2 * F.v;
      shadeLit(F, C.plume[0] * barb, C.plume[1] * barb, C.plume[2] * barb * 0.98);
    },
  };
}
function cordMatLocal() {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.35; S.spec = 0.4; S.shin = 18; S.specTint = 0.2;
      const tw = 0.78 + 0.22 * Math.sin(F.v * 300 + F.u * 12.57);
      F.tag = 6;
      shadeLit(F, C.cord[0] * tw, C.cord[1] * tw, C.cord[2] * tw);
    },
  };
}
function tasselMat() {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.35; S.spec = 0.3; S.shin = 14;
      const k = 0.72 + 0.28 * Math.sin(F.u * 6.283 * 18);
      F.tag = 6;
      shadeLit(F, C.cord[0] * k, C.cord[1] * k, C.cord[2] * k);
    },
  };
}

export function buildHead(sk, face, expr, lod, skinTone) {
  const s = sk.s;
  const hf = sk.head;
  const out = [];
  const nu = Math.max(14, Math.round(80 * lod)), nv = Math.max(10, Math.round(64 * lod));
  const m = gridSurface(nu, nv, (u, v) => {
    const p = headRest(u, v, face, expr);
    return hf.p(p[0] * s, p[1] * s, p[2] * s);
  }, { wrapU: true, flip: true });
  m.material = faceMat(face, expr, skinTone);
  out.push(m);
  // ears
  for (const side of [-1, 1]) {
    const ef = hf.at(hf.p(side * 0.071 * s * face.width, -0.002 * s, -0.016 * s)).yaw(side * 0.3).pitch(-0.15);
    const ear = ellipsoid(ef, 0.01 * s, 0.026 * s, 0.018 * s, {
      nu: Math.max(8, Math.round(16 * lod)), nv: Math.max(6, Math.round(12 * lod)),
      deform: (p) => [p[0] * (1 - 0.4 * Math.max(0, -p[2] / (0.021))), p[1], p[2]],
    });
    ear.material = earMat(skinTone, face.ruddy);
    out.push(ear);
  }
  return out;
}
function earMat(tone, ruddy) {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.45; S.trans = 0.12; S.spec = 0.1;
      const k = 1 + ruddy * 0.08;
      F.tag = 5;
      S.ao = 0.6 + 0.3 * Math.abs(Math.sin(F.u * 6.283));
      shadeLit(F, tone[0] * k * 0.92, tone[1] * 0.86, tone[2] * 0.84);
    },
  };
}

// Random face parameters
const HAIR = ['#2a1d14', '#3b2a1c', '#1b1512', '#5a4128', '#6b5a48', '#7a4a2a', '#8a8580', '#211a15'].map(hex);
const IRIS = ['#3a2a1c', '#4a5a66', '#2c2218', '#5a6a58', '#3d3a36'].map(hex);
const SKIN = ['#96654b', '#a27052', '#8a5b43', '#a9785b', '#9c6a4f', '#7f5440', '#a57256'].map(hex);
export function randomFace(rng, age) {
  const hair = rng.pick(HAIR);
  const grey = age > 0.6 ? (age - 0.6) * 1.5 : 0;
  const h = [lerp(hair[0], 0.3, grey), lerp(hair[1], 0.3, grey), lerp(hair[2], 0.29, grey)];
  return {
    age,
    width: rng.gclip(1, 0.035),
    jaw: rng.gclip(1, 0.06),
    nose: rng.gclip(1.02, 0.08),
    noseP: rng.gclip(1.0, 0.12),
    noseW: rng.gclip(1, 0.1),
    hump: Math.max(0, rng.gclip(0.3, 0.5)),
    brow: rng.gclip(1, 0.25),
    cheek: rng.gclip(1, 0.3),
    gaunt: Math.max(0, rng.gclip(0.2 + age * 0.4, 0.3)),
    lips: rng.gclip(1, 0.2),
    chin: rng.gclip(1, 0.3),
    hair: h,
    iris: rng.pick(IRIS),
    tone: rng.pick(SKIN),
    ruddy: rng.range(0.35, 1.0),
    stubble: rng.range(0.15, 0.8),
    grime: rng.chance(0.55) ? rng.range(0.2, 0.8) : 0,
    moustache: rng.chance(0.62 + age * 0.3) ? rng.range(0.7, 1.3) : 0,
    droop: rng.range(0, 1),
    sideburn: rng.range(0.45, 1.1),
    browThick: rng.range(0.8, 1.4),
    lipCol: [0.36, 0.17, 0.14],
    pale: 0,
  };
}
export function exprDefault() {
  return { jaw: 0, brow: 0, eyes: 1, wide: 0, gazeX: 0, gazeY: 0 };
}
