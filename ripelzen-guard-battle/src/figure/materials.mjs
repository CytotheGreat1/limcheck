// Surface materials for the Ripelzen Guard uniform, equipment and bodies.
// Colours follow the reference portrait: deep dark-green coat, black collar/cuffs with pale piping,
// silver-grey plastron, white buff crossbelts, brass fittings, black trousers with pale stripe, black boots,
// black fur bearskin with silver cords, plate and stag insignia, tall pale plume.
import { hex, clamp, smoothstep } from '../core/math.mjs';
import { noise3, fbm3, NoiseTex, hash2 } from '../core/rng.mjs';
import { S, resetS, shadeLit, perturb } from '../core/light.mjs';

export const C = {
  coat: hex('#172e20'),
  coatDark: hex('#12301e'),
  facing: hex('#141414'),
  piping: hex('#c9c5b6'),
  plastron: hex('#a3a69f'),
  leather: hex('#cfc8b4'),
  brass: hex('#b08a3a'),
  silver: hex('#c4c8cb'),
  trousers: hex('#19191b'),
  stripe: hex('#c3c3bb'),
  boot: hex('#0f0e0d'),
  fur: hex('#0c0c0e'),
  cord: hex('#d8d8d0'),
  plume: hex('#eceae3'),
  wood: hex('#5e2d15'),
  woodDark: hex('#3a1a0b'),
  steel: hex('#4a4d52'),
  blackLeather: hex('#121110'),
};

export const TEX = {};
export function initTextures() {
  if (TEX.a) return;
  TEX.a = new NoiseTex(256, 6, 5, 3.1);
  TEX.b = new NoiseTex(256, 12, 4, 7.7);
  TEX.fine = new NoiseTex(256, 32, 3, 1.3);
}

// ---------- torso rest shape (shared by geometry + material) ----------
// rows: [y, rx, rzF, rzB, zc]
export const TORSO = [
  [0.8, 0.07, 0.055, 0.07, -0.012],
  [0.835, 0.135, 0.09, 0.11, -0.012],
  [0.9, 0.16, 0.104, 0.122, -0.012],
  [0.96, 0.166, 0.106, 0.115, -0.006],
  [1.03, 0.148, 0.102, 0.095, 0.0],
  [1.12, 0.148, 0.11, 0.095, 0.0],
  [1.22, 0.156, 0.122, 0.098, 0.0],
  [1.32, 0.163, 0.122, 0.103, -0.005],
  [1.4, 0.168, 0.11, 0.105, -0.012],
  [1.45, 0.162, 0.088, 0.094, -0.02],
  [1.485, 0.125, 0.072, 0.08, -0.026],
  [1.515, 0.075, 0.06, 0.066, -0.03],
  [1.535, 0.042, 0.04, 0.045, -0.03],
];
export const TORSO_Y0 = TORSO[0][0], TORSO_Y1 = TORSO[TORSO.length - 1][0];

export function torsoRow(y, body) {
  const T = TORSO;
  let i = 0;
  while (i < T.length - 2 && T[i + 1][0] < y) i++;
  const a = T[i], b = T[i + 1];
  let k = (y - a[0]) / (b[0] - a[0]);
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const kk = k * k * (3 - 2 * k) * 0.5 + k * 0.5;
  const br = body ? body.breadth : 1;
  const belly = body ? body.belly : 0;
  const bw = belly * Math.exp(-((y - 1.1) * (y - 1.1)) / 0.006) * 0.028;
  return [
    (a[1] + (b[1] - a[1]) * kk) * br,
    a[2] + (b[2] - a[2]) * kk + bw,
    a[3] + (b[3] - a[3]) * kk,
    a[4] + (b[4] - a[4]) * kk,
  ];
}
// rest-space point on torso from params (u around, v along)
export function torsoRest(u, v, body) {
  const y = TORSO_Y0 + (TORSO_Y1 - TORSO_Y0) * v;
  const [rx, rzF, rzB, zc] = torsoRow(y, body);
  const th = u * Math.PI * 2;
  const c = Math.cos(th), s = Math.sin(th);
  const q = 2 / 2.3;
  const cx = c < 0 ? -Math.pow(-c, q) : Math.pow(c, q);
  const sz = s < 0 ? -Math.pow(-s, q) : Math.pow(s, q);
  return [rx * cx, y, zc + (s > 0 ? rzF : rzB) * sz];
}

// Crossbelt planes in rest space
const B1 = [0.85, 0.527, 0.0]; // over left shoulder -> right hip (cartridge box)
const B2 = [-0.85, 0.527, 0.0]; // over right shoulder -> left hip (sword)
const BC = [0, 1.215, 0];
const BELT_W = 0.034;
export function beltDist(p, which) {
  const n = which === 1 ? B1 : B2;
  return n[0] * (p[0] - BC[0]) + n[1] * (p[1] - BC[1]) + n[2] * (p[2] - BC[2]);
}
export const WAIST = [1.018, 1.07];

function plastronHalf(y) {
  return 0.062 + (y - 1.2) * 0.1;
}

// ---------- cloth folds (height fields in surface parameter space) ----------
const TAU = Math.PI * 2;
// sharp-valley crease profile of a phase t
const crease = (t) => { const x = Math.sin(TAU * t); return x > 0 ? x * 0.6 : -Math.pow(-x, 0.55); };
function sleeveH(u, v, elbowV, seed) {
  const n = TEX.a.at(u * 1.3 + seed, v * 1.7);
  const w = Math.exp(-((v - elbowV) * (v - elbowV)) / 0.045);
  let h = w * crease(u * 2 + v * 5.5 + n * 0.9 + seed) * 1.0;
  h += w * 0.5 * crease(-u * 3 + v * 9 + n * 1.3);
  h += 0.3 * TEX.a.at(u * 0.5 + seed, v * 0.6);
  return h;
}
function trouserH(u, v, seed) {
  const n = TEX.a.at(u * 1.1 + seed, v * 1.4);
  const knee = Math.exp(-((1 - v) * (1 - v)) / 0.03);
  const hip = Math.exp(-(v * v) / 0.05);
  let h = knee * crease(v * 7 + Math.sin(u * TAU * 2 + n * 2) * 0.35 + n);
  h += hip * crease(u * 2 - v * 4 + n);
  h += 0.3 * TEX.a.at(u * 0.5 + seed, v * 0.5);
  return h;
}
export function foldPerturb(F, hfn, k, e = 0.004) {
  const u = F.u, v = F.v;
  const du = (hfn(u + e, v) - hfn(u - e, v)) / (2 * e);
  const dv = (hfn(u, v + e) - hfn(u, v - e)) / (2 * e);
  perturb(F, du * 0.01, dv * 0.01, k);
  return hfn(u, v);
}

// ---------- helper: cloth ----------
function clothVar(F, scale, amt) {
  const n = TEX.a.at(F.px * scale + F.pz * 0.37 * scale, F.py * scale + F.pz * 0.61 * scale);
  return 1 + n * amt;
}

// ---------- materials ----------
export function coatTorsoMat(opts) {
  const { body, wear = 0, officer = false } = opts;
  return {
    shade(F) {
      resetS();
      const p = torsoRest(F.u, F.v, body);
      const x = p[0], y = p[1], z = p[2];
      // cloth folds: compression at the waist, drag lines under the arms, general looseness
      const fh = foldPerturb(F, (u, v) => {
        const yy = TORSO_Y0 + (TORSO_Y1 - TORSO_Y0) * v;
        const waist = Math.exp(-((yy - 1.1) * (yy - 1.1)) / 0.004);
        const arm = Math.exp(-((yy - 1.33) * (yy - 1.33)) / 0.003);
        const n = TEX.a.at(u * 2.1, v * 1.7);
        return waist * crease(v * 14 + Math.sin(u * TAU * 3) * 0.3 + n) * 0.8 + arm * crease(u * 9 + v * 6 + n) * 0.5 + 0.3 * TEX.a.at(u * 0.6, v * 0.5);
      }, 1.2);
      let c = C.coat;
      let r = c[0], g = c[1], b = c[2];
      S.wrap = 0.3; S.sheen = 0.12;
      const front = z > 0.0;
      const vv = clothVar(F, 2.5, 0.08);
      r *= vv; g *= vv; b *= vv;
      // plastron (silver-grey front panel) with piping and two button rows
      if (!officer || true) {
        const hw = plastronHalf(y);
        if (front && y > 1.2 && y < 1.505 && Math.abs(x) < hw) {
          const pv = clothVar(F, 3, 0.06);
          r = C.plastron[0] * pv; g = C.plastron[1] * pv; b = C.plastron[2] * pv;
          // subtle vertical folds
          const fold = 0.93 + 0.07 * Math.sin(x * 160 + TEX.b.at(y * 3, x * 3) * 3);
          r *= fold; g *= fold; b *= fold;
          if (Math.abs(x) > hw - 0.006) { r = C.piping[0] * 0.9; g = C.piping[1] * 0.9; b = C.piping[2] * 0.9; }
          // buttons
          for (let k = 0; k < 5; k++) {
            const by = 1.25 + k * 0.052;
            const bx = hw - 0.017;
            const d1 = Math.hypot(Math.abs(x) - bx, y - by);
            if (d1 < 0.0078) {
              const t = d1 / 0.0078;
              r = C.silver[0] * (1.1 - t * 0.5); g = C.silver[1] * (1.1 - t * 0.5); b = C.silver[2] * (1.1 - t * 0.5);
              S.spec = 1.4; S.shin = 60; S.specTint = 0.5; S.sheen = 0;
            }
          }
        }
      }
      // buttons down the green front below the plastron
      if (front && y > 1.075 && y < 1.2 && Math.abs(x) < 0.03) {
        const d1 = Math.hypot(x, ((y - 1.075) % 0.038) - 0.019);
        if (d1 < 0.0072) { r = C.silver[0]; g = C.silver[1]; b = C.silver[2]; S.spec = 1.2; S.shin = 50; S.specTint = 0.5; }
      }
      // crossbelts
      if (!officer) {
        const d1 = beltDist(p, 1), d2 = beltDist(p, 2);
        const inB1 = Math.abs(d1) < BELT_W, inB2 = Math.abs(d2) < BELT_W;
        if ((inB1 || inB2) && y < 1.5) {
          const d = inB2 && (!inB1 || !front) ? d2 : d1; // sword belt over box belt except front crossing
          const e = Math.abs(d) / BELT_W;
          const lv = clothVar(F, 4, 0.04);
          const edge = e > 0.86 ? 0.72 : 1;
          r = C.leather[0] * lv * edge; g = C.leather[1] * lv * edge; b = C.leather[2] * lv * edge;
          S.spec = 0.18; S.shin = 14; S.sheen = 0.05;
          if (wear > 0) { const dd = 1 - wear * 0.25 * (0.5 + 0.5 * TEX.b.at(F.px * 2, F.py * 2)); r *= dd; g *= dd * 0.98; b *= dd * 0.94; }
        }
      } else {
        // officer: silver sash-belt over the right shoulder only (narrow)
        const d2 = beltDist(p, 2);
        if (Math.abs(d2) < 0.024 && y < 1.5 && y > 1.06) {
          r = C.silver[0] * 0.8; g = C.silver[1] * 0.8; b = C.silver[2] * 0.8; S.spec = 0.8; S.shin = 30; S.specTint = 0.4;
        }
      }
      // waist belt
      if (y > WAIST[0] && y < WAIST[1]) {
        const e = Math.min(y - WAIST[0], WAIST[1] - y) / 0.026;
        const edge = e < 0.18 ? 0.75 : 1;
        r = C.leather[0] * edge; g = C.leather[1] * edge; b = C.leather[2] * edge;
        S.spec = 0.2; S.shin = 14; S.specTint = 0;
        if (officer) { r = C.silver[0] * 0.75 * edge; g = C.silver[1] * 0.75 * edge; b = C.silver[2] * 0.75 * edge; S.spec = 0.7; }
      }
      // shoulder straps (green with pale piping) painted on the shoulder tops
      if (y > 1.43 && Math.abs(x) > 0.07 && Math.abs(x) < 0.165 && Math.abs(z + 0.02) < 0.028) {
        const e = Math.abs(z + 0.02);
        if (e > 0.021) { r = C.piping[0] * 0.85; g = C.piping[1] * 0.85; b = C.piping[2] * 0.85; }
        else { r = C.coat[0] * 1.1; g = C.coat[1] * 1.1; b = C.coat[2] * 1.1; }
      }
      // below the belt the torso shows the trousers (skirts are separate)
      if (y < WAIST[0]) {
        const tv = clothVar(F, 2.5, 0.1);
        r = C.trousers[0] * tv; g = C.trousers[1] * tv; b = C.trousers[2] * tv;
        S.spec = 0; S.sheen = 0.14;
      }
      // simple creases / occlusion at waist and under arms
      let ao = 1;
      ao *= 1 - 0.25 * Math.exp(-((y - 1.0) * (y - 1.0)) / 0.0006);
      ao *= 1 - 0.35 * smoothstep(0.11, 0.165, Math.abs(x)) * smoothstep(1.25, 1.4, y) * (1 - smoothstep(1.43, 1.47, y));
      S.ao = ao;
      if (wear > 0) { const d = 1 + wear * 0.18 * TEX.b.at(F.px * 3 + 5, F.py * 3); r *= d; g *= d; b *= d * 0.97; }
      F.tag = 2;
      shadeLit(F, r, g, b);
    },
  };
}

export function clothMat(col, { sheen = 0.1, scale = 2.5, amt = 0.08, tag = 2, ao = 1 } = {}) {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.3; S.sheen = sheen; S.ao = ao;
      const vv = clothVar(F, scale, amt);
      F.tag = tag;
      shadeLit(F, col[0] * vv, col[1] * vv, col[2] * vv);
    },
  };
}

// Sleeve: u around, v along the arm (0 shoulder .. 1 wrist). Cuff black with pale piping at the top edge.
export function sleeveMat({ cuffStart = 0.78, isFore = false, officer = false } = {}) {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.3; S.sheen = 0.12;
      let c = C.coat;
      const vv = clothVar(F, 2.5, 0.08);
      let r = c[0] * vv, g = c[1] * vv, b = c[2] * vv;
      const elbowV = isFore ? 0.0 : 1.0;
      const fh = foldPerturb(F, (u, v) => sleeveH(u, v, elbowV, isFore ? 3.1 : 0.7), 1.6);
      const cr = 1 - 0.18 * Math.max(0, -fh) * Math.exp(-((F.v - elbowV) ** 2) / 0.06);
      r *= cr; g *= cr; b *= cr;
      if (isFore && F.v > cuffStart) {
        const e = F.v - cuffStart;
        if (e < 0.03) { r = C.piping[0] * 0.9; g = C.piping[1] * 0.9; b = C.piping[2] * 0.9; }
        else { r = C.facing[0] * vv; g = C.facing[1] * vv; b = C.facing[2] * vv; }
        if (officer && e > 0.05 && e < 0.07) { r = C.silver[0] * 0.8; g = C.silver[1] * 0.8; b = C.silver[2] * 0.8; S.spec = 0.8; S.shin = 30; }
      }
      F.tag = 2;
      shadeLit(F, r, g, b);
    },
  };
}

// Trousers: black wool, pale stripe along the outer seam. u around (u=0 at +a axis = outward), v along.
export function trouserMat(outward) {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.3; S.sheen = 0.14;
      const vv = clothVar(F, 2.5, 0.1);
      let r = C.trousers[0] * vv, g = C.trousers[1] * vv, b = C.trousers[2] * vv;
      let du = F.u - outward; du -= Math.round(du);
      if (Math.abs(du) < 0.022) { r = C.stripe[0] * 0.9; g = C.stripe[1] * 0.9; b = C.stripe[2] * 0.9; }
      const fh = foldPerturb(F, (u, v) => trouserH(u, v, outward * 3 + 1), 1.5);
      const cr = 1 - 0.12 * Math.max(0, -fh);
      F.tag = 2;
      shadeLit(F, r * cr, g * cr, b * cr);
    },
  };
}

export function leatherMat(col, { spec = 0.9, shin = 35, tag = 3, scuff = 0.15 } = {}) {
  return {
    shade(F) {
      resetS();
      S.spec = spec; S.shin = shin; S.wrap = 0.15;
      const n = TEX.b.at(F.px * 4 + F.pz * 2, F.py * 4);
      const sc = 1 + scuff * n;
      S.spec = spec * (0.7 + 0.3 * (0.5 + 0.5 * TEX.fine.at(F.px * 3, F.py * 3 + F.pz)));
      F.tag = tag;
      shadeLit(F, col[0] * sc, col[1] * sc, col[2] * sc);
    },
  };
}

export function metalMat(col, { spec = 2.0, shin = 70, tint = 0.8, tag = 4 } = {}) {
  return {
    shade(F) {
      resetS();
      S.spec = spec; S.shin = shin; S.specTint = tint; S.wrap = 0.1; S.sheen = 0.2;
      const n = 1 + 0.1 * TEX.fine.at(F.px * 5, F.py * 5 + F.pz * 3);
      F.tag = tag;
      shadeLit(F, col[0] * n, col[1] * n, col[2] * n);
    },
  };
}

export function whiteLeatherMat() {
  return {
    shade(F) {
      resetS();
      S.spec = 0.15; S.shin = 12; S.wrap = 0.3;
      const n = 1 + 0.05 * TEX.a.at(F.px * 15, F.py * 15 + F.pz * 7);
      F.tag = 2;
      shadeLit(F, C.leather[0] * n, C.leather[1] * n, C.leather[2] * n);
    },
  };
}

// Musket stock: polished walnut with grain along v
export function woodMat() {
  return {
    shade(F) {
      resetS();
      S.spec = 0.55; S.shin = 30; S.wrap = 0.2; S.specTint = 0.3;
      const g = TEX.a.at(F.u * 0.7 + F.px * 0.2, F.v * 18 + F.pz * 0.3);
      const k = 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(F.v * 120 + g * 8));
      const d = 1 + 0.2 * TEX.b.at(F.v * 6, F.u * 2);
      F.tag = 4;
      shadeLit(F, C.wood[0] * k * d, C.wood[1] * k * d, C.wood[2] * k * d);
    },
  };
}

// Skin with warm translucency; face-specific painting is handled in head.mjs
export function skinMat(tone) {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.45; S.spec = 0.12; S.shin = 14; S.sheen = 0.05;
      const n = 1 + 0.06 * TEX.a.at(F.px * 20, F.py * 20 + F.pz * 11);
      F.tag = 5;
      shadeLit(F, tone[0] * n, tone[1] * n * 0.98, tone[2] * n * 0.96);
    },
  };
}

// Pale piping/cord material
export function cordMat() {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.35; S.spec = 0.25; S.shin = 16; S.specTint = 0.1;
      const tw = 0.82 + 0.18 * Math.sin(F.v * 260 + F.u * 12.57);
      F.tag = 6;
      shadeLit(F, C.cord[0] * tw, C.cord[1] * tw, C.cord[2] * tw);
    },
  };
}

export function plumeMat() {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.5; S.trans = 0.35; S.twoSided = true; S.sheen = 0.2; S.noShadow = false;
      const barb = 0.8 + 0.2 * Math.sin(F.u * 90 + F.v * 40 + TEX.b.at(F.u * 3, F.v * 5) * 5);
      const n = barb * (1 + 0.08 * TEX.a.at(F.u * 4, F.v * 8));
      F.tag = 6;
      shadeLit(F, C.plume[0] * n, C.plume[1] * n, C.plume[2] * n);
    },
  };
}

export { hash2, noise3, fbm3, clamp };
