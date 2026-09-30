// Scene lighting environment + the common lit-surface shading routine.
import { norm } from './math.mjs';

export const Env = {
  cam: null,
  sunDir: norm([-0.78, 0.52, -0.34]), // toward the sun
  sunCol: [1.0, 0.8, 0.56],
  sunI: 3.4,
  skyCol: [0.36, 0.4, 0.46],
  groundCol: [0.2, 0.18, 0.12],
  rimCol: [0.9, 0.84, 0.72],
  cascades: [], // [{sm, contains(x,y,z), bias, radius}]
  sunMask: null, // (x,z) -> [0,1] cloud / smoke shadow on sunlight
  aoFn: null, // (x,y,z) -> [0,1] extra occlusion (ground contact etc.)
  atmo: null, // (F, r,g,b) -> applies aerial perspective, writes F.r/g/b
};

export function shadowVis(x, y, z, nx = 0, ny = 0, nz = 0) {
  const cs = Env.cascades;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.contains(x, y, z)) {
      const o = c.normalOffset;
      return c.sm.vis(x + nx * o, y + ny * o, z + nz * o, c.bias, c.radius);
    }
  }
  return 1;
}

// Output of shadeLit goes into F.r,g,b (linear, pre-atmosphere) then atmosphere is applied.
// opts via module-level scratch to avoid allocation:
export const S = {
  spec: 0, shin: 20, specTint: 1, // specular strength, exponent, tint toward albedo (metal)
  wrap: 0.25, ao: 1, rim: 0.0, sheen: 0, trans: 0, emit: 0,
  twoSided: false, noShadow: false,
  aniso: 0, anisoShin: 40, tx: 0, ty: 1, tz: 0, // Kajiya-Kay strand highlight (fur/hair)
  anisoCol: null,
};
export function resetS() {
  S.spec = 0; S.shin = 20; S.specTint = 0; S.wrap = 0.25; S.ao = 1; S.rim = 0; S.sheen = 0;
  S.trans = 0; S.emit = 0; S.twoSided = false; S.noShadow = false;
  S.aniso = 0; S.anisoCol = null;
}

export function shadeLit(F, ar, ag, ab) {
  if (Env.debugAlbedo) { F.r = ar; F.g = ag; F.b = ab; return; }
  const cam = Env.cam;
  let nx = F.nx, ny = F.ny, nz = F.nz;
  let nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  let vx = cam.pos[0] - F.px, vy = cam.pos[1] - F.py, vz = cam.pos[2] - F.pz;
  const vl = Math.hypot(vx, vy, vz) || 1;
  vx /= vl; vy /= vl; vz /= vl;
  let ndv = nx * vx + ny * vy + nz * vz;
  if (ndv < 0 && S.twoSided) { nx = -nx; ny = -ny; nz = -nz; ndv = -ndv; }
  const L = Env.sunDir;
  const ndl = nx * L[0] + ny * L[1] + nz * L[2];
  let sunV = 1;
  if (Env.sunMask) sunV *= Env.sunMask(F.px, F.pz);
  if (sunV > 0.001 && !S.noShadow && ndl > -S.wrap) sunV *= shadowVis(F.px, F.py, F.pz, nx, ny, nz);
  const w = S.wrap;
  let diff = (ndl + w) / (1 + w);
  diff = diff < 0 ? 0 : diff;
  // light passing through thin material (plume, ears)
  if (S.trans > 0 && ndl < 0) diff += -ndl * S.trans;
  diff *= sunV * Env.sunI;
  let ao = S.ao;
  if (Env.aoFn) ao *= Env.aoFn(F.px, F.py, F.pz);
  const skyw = (0.55 + 0.45 * ny) * ao, grw = (0.45 - 0.45 * ny) * ao;
  const sc = Env.sunCol, kc = Env.skyCol, gc = Env.groundCol;
  // reference data for the painter: local colour, light, ambient, surface orientation
  F.ar = ar; F.ag = ag; F.ab = ab;
  F.lsun = diff / Env.sunI; F.lamb = ao * (0.55 + 0.45 * ny);
  F.lspec = 0; F.fog = 0;
  const cr = cam.right, cu = cam.up;
  F.snx = nx * cr[0] + ny * cr[1] + nz * cr[2];
  F.sny = nx * cu[0] + ny * cu[1] + nz * cu[2];
  let r = ar * (sc[0] * diff + kc[0] * skyw + gc[0] * grw);
  let g = ag * (sc[1] * diff + kc[1] * skyw + gc[1] * grw);
  let b = ab * (sc[2] * diff + kc[2] * skyw + gc[2] * grw);
  if (S.spec > 0 && sunV > 0) {
    let hx = L[0] + vx, hy = L[1] + vy, hz = L[2] + vz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    const ndh = (nx * hx + ny * hy + nz * hz) / hl;
    if (ndh > 0 && ndl > 0) {
      const s = S.spec * Math.pow(ndh, S.shin) * sunV * Env.sunI * (0.3 + 0.7 * Math.min(1, ndl * 3));
      const t = S.specTint;
      F.lspec += s / Env.sunI;
      r += s * sc[0] * (1 - t + t * ar * 3);
      g += s * sc[1] * (1 - t + t * ag * 3);
      b += s * sc[2] * (1 - t + t * ab * 3);
    }
    // broad sky reflection for glossy things
    const fr = Math.pow(1 - Math.max(0, ndv), 3) * S.spec * 0.25 * ao;
    r += fr * kc[0] * 1.5; g += fr * kc[1] * 1.5; b += fr * kc[2] * 1.5;
  }
  if (S.aniso > 0 && sunV > 0) {
    let hx = L[0] + vx, hy = L[1] + vy, hz = L[2] + vz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    const th = (S.tx * hx + S.ty * hy + S.tz * hz) / hl;
    const sn = Math.sqrt(Math.max(0, 1 - th * th));
    const a = S.aniso * Math.pow(sn, S.anisoShin) * sunV * Env.sunI * Math.max(0, Math.min(1, ndl + 0.35));
    const ac = S.anisoCol || sc;
    F.lspec += a / Env.sunI * 0.5;
    r += a * ac[0]; g += a * ac[1]; b += a * ac[2];
  }
  if (S.sheen > 0) {
    const fr = Math.pow(1 - Math.max(0, ndv), 2.5) * S.sheen * ao;
    r += fr * kc[0]; g += fr * kc[1]; b += fr * kc[2];
  }
  if (S.rim > 0) {
    const fr = Math.pow(1 - Math.max(0, ndv), 4) * S.rim * ao;
    const rc = Env.rimCol;
    r += fr * rc[0]; g += fr * rc[1]; b += fr * rc[2];
  }
  if (S.emit > 0) { r += S.emit * ar; g += S.emit * ag; b += S.emit * ab; }
  if (Env.atmo) Env.atmo(F, r, g, b, vl);
  else { F.r = r; F.g = g; F.b = b; }
}

// Tilt the fragment normal by a height-field gradient expressed along the surface tangent (u) and
// bitangent (v) directions. du, dv: slopes; k: strength.
export function perturb(F, du, dv, k = 1) {
  let nx = F.nx, ny = F.ny, nz = F.nz;
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  let tx = F.tx, ty = F.ty, tz = F.tz;
  const d = tx * nx + ty * ny + tz * nz;
  tx -= nx * d; ty -= ny * d; tz -= nz * d;
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  F.nx = nx - k * (du * tx + dv * bx);
  F.ny = ny - k * (du * ty + dv * by);
  F.nz = nz - k * (du * tz + dv * bz);
}
