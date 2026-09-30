// Body meshes: torso with coat, skirts, collar, arms, hands, legs and boots.
import { Frame, add, sub, mul, madd, norm, cross, dot, len, perp, rotAxis, vlerp, lerp, smoothstep } from '../core/math.mjs';
import { gridSurface, mergeMeshes } from '../core/mesh.mjs';
import { limb, ellipsoid, superBox, sweep, capProfile, ribbon, spow } from './geom.mjs';
import { noise2 } from '../core/rng.mjs';
// irregular cloth silhouette: soft bunching folds
const clothDisp = (seed, amt, freq = 3) => (t, th) => amt * (noise2(t * freq + seed, Math.cos(th) * 1.2 + seed * 0.3) * 0.7 + noise2(t * freq * 2.3 - seed, Math.sin(th) * 1.5) * 0.3);
import { REF } from './skeleton.mjs';
import {
  C, TEX, torsoRest, torsoRow, TORSO_Y0, TORSO_Y1, coatTorsoMat, clothMat, sleeveMat, trouserMat, leatherMat,
  metalMat, skinMat,
} from './materials.mjs';
import { S, resetS, shadeLit, Env, perturb } from '../core/light.mjs';

// Map a rest-space torso point (standing coords, s=1) into the posed world.
export function torsoMap(sk, p) {
  const s = sk.s, y = p[1];
  const x = p[0] * s, z = p[2] * s;
  if (y < 1.06) {
    const w = smoothstep(0.95, 1.06, y);
    const a = sk.pelvis.p(x, (y - 0.94) * s, z);
    if (w <= 0) return a;
    const b = sk.lumbar.p(x, (y - 0.94) * s, z);
    return vlerp(a, b, w);
  }
  const w = smoothstep(1.06, 1.24, y);
  const a = sk.lumbar.p(x, (y - 0.94) * s, z);
  if (w <= 0) return a;
  const b = sk.chest.p(x, (y - 1.3) * s, z);
  return vlerp(a, b, w);
}

function res(lod, a, b) { return Math.max(b, Math.round(a * lod)); }

export function buildTorso(sk, att, lod) {
  const body = sk.body;
  const m = gridSurface(res(lod, 56, 10), res(lod, 44, 8), (u, v) => torsoMap(sk, torsoRest(u, v, body)), { wrapU: true, flip: true });
  m.material = coatTorsoMat({ body, wear: att.wear, officer: att.officer });
  return m;
}

// Coat skirts (open at the front) with tail swing. swing: world vector added at the hem.
export function buildSkirt(sk, att, lod) {
  const body = sk.body;
  const out = [];
  const officer = att.officer;
  const panels = [[0.33, 0.742], [0.758, 1.17]];
  for (const [u0, u1] of panels) {
    const m = gridSurface(res(lod, 22, 5), res(lod, 10, 3), (uu, v) => {
      const u = u0 + (u1 - u0) * uu;
      const back = Math.max(0, -Math.sin(u * Math.PI * 2));
      const hem = (officer ? 0.7 : 0.79) - back * (officer ? 0.12 : 0.07);
      const y = lerp(1.045, hem, v);
      const yr = Math.max(y, 0.95);
      const [rx, rzF, rzB, zc] = torsoRow(yr, body);
      const th = u * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const q = 2 / 2.3;
      const flare = 0.012 + 0.055 * v * v + 0.02 * v;
      const px = (rx + flare) * spow(c, q);
      const pz = zc + ((sn > 0 ? rzF : rzB) + flare) * spow(sn, q);
      let P = torsoMap(sk, [px, y, pz]);
      if (att.swing) P = madd(P, att.swing, v * v);
      return P;
    }, { flip: false });
    m.material = skirtMat(u0, u1);
    out.push(m);
  }
  return out;
}

function skirtMat(u0, u1) {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.3; S.sheen = 0.1; S.twoSided = true;
      // detect back face
      const cam = Env.cam;
      const vx = cam.pos[0] - F.px, vy = cam.pos[1] - F.py, vz = cam.pos[2] - F.pz;
      const inside = F.nx * vx + F.ny * vy + F.nz * vz < 0;
      const vv = 1 + 0.08 * TEX.a.at(F.px * 2.5, F.py * 2.5 + F.pz * 1.5);
      let col = inside ? C.coatDark : C.coat;
      let r = col[0] * vv, g = col[1] * vv, b = col[2] * vv;
      // pale piping at the hem and on the front edges (turnbacks)
      const edgeU = Math.min(F.u, 1 - F.u) * (u1 - u0) * 2 * Math.PI * 0.16;
      if (F.v > 0.93 || edgeU < 0.012) { r = C.piping[0] * 0.92; g = C.piping[1] * 0.92; b = C.piping[2] * 0.92; }
      // vertical flutes in the skirts
      const ph = F.u * 9 + TEX.b.at(F.u * 3, F.v) * 1.2;
      perturb(F, Math.cos(ph * 6.283) * 0.35 * (0.3 + F.v), 0, 1);
      const fold = 0.9 + 0.1 * Math.sin(ph * 6.283);
      r *= fold; g *= fold; b *= fold;
      S.ao = inside ? 0.5 : 1 - 0.25 * (1 - F.v);
      F.tag = 2;
      shadeLit(F, r, g, b);
    },
  };
}

export function buildCollar(sk, att, lod) {
  const s = sk.s;
  const fr = sk.chest;
  const nf = sk.neckFr;
  const m = gridSurface(res(lod, 32, 8), res(lod, 5, 2), (u, v) => {
    const th = u * Math.PI * 2;
    const h = v * 0.085;
    const rx = (0.061 - v * 0.006) * s, rz = (0.06 - v * 0.006) * s;
    // base follows the chest, top follows the neck a little
    const base = fr.p(0, (0.205 + h) * s, (-0.022) * s);
    const top = madd(sk.neckBase, nf.y, (0.012 + h) * s);
    const c = vlerp(base, top, v * 0.6);
    const X = vlerp(fr.x, nf.x, v * 0.6), Z = vlerp(fr.z, nf.z, v * 0.6);
    return [
      c[0] + X[0] * rx * Math.cos(th) + Z[0] * rz * Math.sin(th),
      c[1] + X[1] * rx * Math.cos(th) + Z[1] * rz * Math.sin(th),
      c[2] + X[2] * rx * Math.cos(th) + Z[2] * rz * Math.sin(th),
    ];
  }, { wrapU: true, flip: true });
  m.material = {
    shade(F) {
      resetS();
      S.twoSided = true; S.wrap = 0.3; S.sheen = 0.1;
      let c = C.facing;
      const top = F.v > 0.86;
      if (top) c = C.piping;
      const k = top ? 0.9 : 1;
      F.tag = 2;
      if (att.officer && F.v < 0.8 && F.v > 0.55) { S.spec = 0.8; S.shin = 30; shadeLit(F, C.silver[0] * 0.8, C.silver[1] * 0.8, C.silver[2] * 0.8); return; }
      shadeLit(F, c[0] * k, c[1] * k, c[2] * k);
    },
  };
  return m;
}

export function buildShoulderStraps(sk, att, lod) {
  const s = sk.s;
  const out = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const pts = [], wd = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const x = side * lerp(0.075, 0.175, t);
      const y = lerp(1.505, 1.455, t) + 0.012;
      const zc = -0.02;
      // sit on top of the torso surface
      const [rx, rzF, rzB] = torsoRow(y - 0.012, sk.body);
      const P = torsoMap(sk, [x, y + 0.004 * Math.sin(t * Math.PI), zc]);
      pts.push(P);
      wd.push(sk.chest.z);
    }
    const m = ribbon(pts, wd, 0.05 * s, { nu: 3 });
    if (att.officer) {
      // officer: silver epaulette with fringe
      m.material = metalMat(C.silver, { spec: 1.2, shin: 30, tint: 0.5 });
    } else {
      m.material = {
        shade(F) {
          resetS(); S.twoSided = true; S.wrap = 0.3;
          const e = Math.abs(F.u - 0.5) > 0.38;
          const c = e ? C.piping : C.coat;
          F.tag = 2;
          shadeLit(F, c[0], c[1], c[2]);
        },
      };
    }
    out.push(m);
    if (att.officer) {
      // fringe: short cylinder at the shoulder end
      const end = pts[pts.length - 1];
      const fr = Frame.fromUpFwd(end, sk.chest.y, sk.chest.z);
      const fringe = limb(madd(end, sk.chest.y, 0.005), madd(madd(end, sk.chest.y, -0.06 * s), sk.chest.x, side * 0.02 * s), sk.chest.z,
        (t) => [0.05 * s * (1 - 0.3 * t), 0.045 * s], { nu: 14, nv: 3, capA: 0.01 });
      fringe.material = cordFringeMat();
      out.push(fringe);
    }
  }
  return out;
}

function cordFringeMat() {
  return {
    shade(F) {
      resetS(); S.spec = 0.9; S.shin = 25; S.specTint = 0.5; S.wrap = 0.3;
      const k = 0.7 + 0.3 * Math.sin(F.u * 6.283 * 22);
      F.tag = 4;
      shadeLit(F, C.silver[0] * k * 0.85, C.silver[1] * k * 0.85, C.silver[2] * k * 0.85);
    },
  };
}

export function buildArms(sk, att, lod) {
  const s = sk.s;
  const out = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const sh = sk.shoulder[i], el = sk.elbow[i], wr = sk.wrist[i];
    const ref = sk.chest.z;
    // deltoid cap
    const upDir = norm(sub(el, sh));
    const dfr = Frame.fromUpFwd(madd(sh, upDir, 0.012 * s), mul(upDir, -1), perp(sk.chest.z, upDir));
    const del = ellipsoid(dfr, 0.05 * s, 0.062 * s, 0.05 * s, { nu: res(lod, 20, 8), nv: res(lod, 12, 5) });
    del.material = clothMat(C.coat);
    out.push(del);
    const ua = limb(sh, el, ref, (t) => {
      const r = (lerp(0.047, 0.039, t) + 0.004 * Math.sin(Math.PI * t)) * s;
      return [r * 0.96, r * 1.04];
    }, { nu: res(lod, 18, 7), nv: res(lod, 10, 3), capA: 0.02 * s, capB: 0.04 * s, disp: clothDisp(i * 7.3 + 1, 0.09) });
    ua.material = sleeveMat({ isFore: false });
    out.push(ua);
    const fa = limb(el, wr, ref, (t) => {
      let r = lerp(0.04, 0.03, t) + 0.004 * Math.sin(Math.PI * Math.min(1, t * 2));
      if (t > 0.72) r = 0.037; // cuff
      return [r * s, r * s * 0.92];
    }, { nu: res(lod, 18, 7), nv: res(lod, 12, 4), capA: 0.035 * s, capB: 0, disp: (t, th) => (t < 0.7 ? clothDisp(i * 5.1 + 3, 0.08)(t, th) : 0) });
    fa.material = sleeveMat({ isFore: true, cuffStart: 0.72, officer: att.officer });
    out.push(fa);
    out.push(...buildHand(sk.hand[i], i === 0, s, lod, att.skinMat));
  }
  return out;
}

// Hand with jointed fingers. hand = {fr (wrist frame), curl:[a,b,c], thumb: 0..1 (opposition), spread}
export function buildHand(hand, isLeft, s, lod, mat) {
  const fr = hand.fr;
  const ts = isLeft ? 1 : -1; // thumb side along frame x
  const out = [];
  const curl = hand.curl || [0.3, 0.4, 0.2];
  const spread = Math.min(0.07, hand.spread ?? 0.04);
  // palm
  const palmFr = new Frame(fr.p(0, -0.002 * s, 0.05 * s), fr.x, fr.y, fr.z);
  const palm = superBox(palmFr, 0.041 * s, 0.0155 * s, 0.05 * s, 2.8, { nu: res(lod, 16, 6), nv: res(lod, 10, 4) });
  palm.material = mat;
  out.push(palm);
  if (lod < 0.35) {
    // mitten block for distant figures
    const d = rotAxis(fr.z, fr.x, curl[0] + curl[1] * 0.5);
    const base = fr.p(0, -0.004 * s, 0.09 * s);
    const tip = madd(base, d, 0.07 * s);
    const mit = limb(base, tip, fr.x, () => [0.038 * s, 0.013 * s], { nu: 8, nv: 2, capA: 0.01 * s, capB: 0.012 * s });
    mit.material = mat;
    out.push(mit);
    return out;
  }
  const FX = [0.027, 0.009, -0.009, -0.026];
  const LEN = [[0.041, 0.024, 0.02], [0.045, 0.027, 0.021], [0.042, 0.025, 0.02], [0.034, 0.019, 0.018]];
  const RAD = [0.0105, 0.011, 0.0104, 0.0094];
  for (let k = 0; k < 4; k++) {
    let p = fr.p(ts * FX[k] * s, -0.003 * s, (0.092 - (k === 3 ? 0.008 : 0) - (k === 0 ? 0.002 : 0)) * s);
    let d = rotAxis(fr.z, fr.y, -ts * spread * (k - 1.3));
    let axis = fr.x;
    const ck = 1 + (k - 1.5) * 0.05; // little finger curls a bit more
    for (let j = 0; j < 3; j++) {
      d = rotAxis(d, axis, curl[j] * ck);
      const q = madd(p, d, LEN[k][j] * s);
      const r0 = RAD[k] * (1 - j * 0.1) * s;
      const seg = limb(p, q, fr.y, (t) => [r0 * (1 - 0.08 * t), r0 * 0.88 * (1 - 0.08 * t)], {
        nu: res(lod, 8, 5), nv: 2, capA: r0 * 0.9, capB: j === 2 ? r0 * 0.95 : r0 * 0.9,
      });
      seg.material = mat;
      out.push(seg);
      p = q;
    }
  }
  // thumb
  const tb = fr.p(ts * 0.03 * s, -0.012 * s, 0.022 * s);
  const opp = hand.thumb ?? 0.5;
  let d = norm(fr.d(ts * (0.8 - opp * 0.35), -0.3 - opp * 0.45, 0.55));
  const bendAxis = norm(cross(d, fr.y));
  let p = tb;
  const TL = [0.04, 0.031, 0.026];
  for (let j = 0; j < 3; j++) {
    d = rotAxis(d, bendAxis, -ts * (j === 0 ? 0 : (curl[1] * 0.5 + 0.1)) );
    const q = madd(p, d, TL[j] * s);
    const r0 = (j === 0 ? 0.0135 : 0.0105) * s;
    const seg = limb(p, q, fr.y, () => [r0, r0 * 0.88], { nu: res(lod, 8, 5), nv: 2, capA: r0 * 0.9, capB: r0 * 0.95 });
    seg.material = mat;
    out.push(seg);
    p = q;
  }
  return out;
}

export function buildLegs(sk, att, lod) {
  const s = sk.s;
  const out = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const hip = sk.hip[i], kn = sk.knee[i], an = sk.ankle[i];
    const ref = sk.pelvis.x; // rx axis lateral
    const thigh = limb(hip, kn, mul(ref, side), (t) => {
      const r = lerp(0.086, 0.058, Math.pow(t, 0.9)) * s;
      return [r, r * 1.06];
    }, { nu: res(lod, 20, 8), nv: res(lod, 12, 4), capA: 0.05 * s, capB: 0.04 * s, disp: clothDisp(i * 3.7 + 11, 0.07, 2.5) });
    thigh.material = trouserMat(0);
    out.push(thigh);
    // shin (mostly hidden by boot)
    const shin = limb(kn, an, mul(ref, side), (t) => {
      const r = (0.052 - 0.012 * t + 0.006 * Math.sin(Math.PI * Math.min(1, t * 1.6))) * s;
      return [r, r];
    }, { nu: res(lod, 16, 7), nv: res(lod, 6, 3), capA: 0.045 * s });
    shin.material = trouserMat(0);
    out.push(shin);
    // boot shaft: from ankle up 82% toward knee
    const top = vlerp(an, kn, 0.84);
    const shaft = limb(madd(an, sk.foot[i].y, -0.01 * s), top, sk.foot[i].z, (t) => {
      const r = (0.047 + 0.013 * t + 0.004 * Math.sin(Math.PI * t)) * s;
      return [r * 1.02, r];
    }, { nu: res(lod, 20, 8), nv: res(lod, 8, 3), capA: 0 });
    shaft.material = bootMat(true);
    out.push(shaft);
    out.push(buildBootFoot(sk.foot[i], s, lod));
  }
  return out;
}

function bootMat(shaft) {
  return {
    shade(F) {
      resetS();
      S.spec = 0.7; S.shin = 28; S.wrap = 0.2; S.twoSided = true;
      const n = TEX.b.at(F.px * 5 + F.pz * 3, F.py * 5);
      // wrinkles at the ankle
      const wr = shaft ? Math.exp(-F.v * 6) * (0.5 + 0.5 * Math.sin(F.v * 70 + F.u * 9)) : 0;
      if (shaft) perturb(F, 0, Math.cos(F.v * 70 + F.u * 9 + TEX.a.at(F.u, F.v) * 3) * Math.exp(-F.v * 5) * 0.5, 1);
      S.spec *= 0.65 + 0.35 * (0.5 + 0.5 * n) - wr * 0.4;
      let r = C.boot[0], g = C.boot[1], b = C.boot[2];
      // top rim of the boot
      if (shaft && F.v > 0.965) { r *= 1.6; g *= 1.6; b *= 1.6; }
      // mud/dust near the sole
      const dust = shaft ? 0 : Math.max(0, 0.6 - F.ex) * 0.5;
      F.tag = 3;
      shadeLit(F, r + dust * 0.05, g + dust * 0.04, b + dust * 0.025);
    },
  };
}

function buildBootFoot(ffr, s, lod) {
  // foot frame at ankle; z toward toe; y up. Sole at y = -0.078s.
  const m = gridSurface(res(lod, 20, 8), res(lod, 14, 5), (u, v) => {
    const th = u * Math.PI * 2;
    // along: z from -0.06 (heel) to 0.2 (toe)
    const z = lerp(-0.052, 0.19, v);
    // section: width, top height, bottom
    const w = (v < 0.1 ? lerp(0.022, 0.034, v / 0.1) : v < 0.72 ? lerp(0.034, 0.042, (v - 0.1) / 0.62) : lerp(0.042, 0.014, Math.pow((v - 0.72) / 0.28, 1.8))) * s;
    const bot = -0.078 * s;
    const topH = (v < 0.3 ? 0.05 : lerp(0.05, -0.02, Math.pow((v - 0.3) / 0.7, 0.9))) * s;
    let tip = 1;
    if (v > 0.9) tip = Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.9) / 0.1, 2)));
    if (v < 0.04) tip = Math.sqrt(Math.max(0, 1 - Math.pow((0.04 - v) / 0.04, 2)));
    const yc = (bot + topH) / 2, hh = (topH - bot) / 2;
    const c = Math.cos(th), sn = Math.sin(th);
    const q = 2 / 3;
    return ffr.p(w * spow(c, q) * tip, yc + hh * spow(sn, q) * Math.max(tip, 0.2), z * s);
  }, { wrapU: true, exFn: (u, v) => Math.sin(u * Math.PI * 2) * 0.5 + 0.5 });
  m.material = bootMat(false);
  return m;
}

export function buildNeck(sk, att, lod) {
  const s = sk.s;
  const a = madd(sk.neckBase, sk.neckFr.y, -0.03 * s);
  const b = madd(sk.head.o, sk.head.y, -0.02 * s);
  const m = limb(a, madd(b, sk.head.z, -0.01 * s), sk.chest.z, (t) => [0.05 * s, 0.054 * s], { nu: res(lod, 16, 6), nv: 3, capA: 0, capB: 0.02 });
  m.material = att.skinMat;
  return m;
}
