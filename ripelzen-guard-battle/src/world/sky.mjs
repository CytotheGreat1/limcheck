// Battlefield sky: towering grey-and-cream clouds mixed with powder smoke, muted blue gaps,
// luminous haze toward the horizon. Also provides the aerial-perspective haze colour.
import { clamp, lerp, smoothstep, hex, norm } from '../core/math.mjs';
import { fbm2, noise2, NoiseTex } from '../core/rng.mjs';
import { Env } from '../core/light.mjs';

const SK = { t1: null, t2: null, t3: null };
function init() {
  if (SK.t1) return;
  SK.t1 = new NoiseTex(512, 6, 6, 21.7);
  SK.t2 = new NoiseTex(512, 12, 5, 4.4);
  SK.t3 = new NoiseTex(256, 24, 4, 8.8);
}

const ZENITH = hex('#68727c');
const BLUE = hex('#8d98a3');
const HORIZ = hex('#c9c2ae');
const CREAM = hex('#efe3c8');
const GREY = hex('#77716a');
const DARK = hex('#4c4743');

// direction -> (azimuth, elevation)
function azEl(d) {
  return [Math.atan2(d[0], d[2]), Math.asin(clamp(d[1], -1, 1))];
}

export function hazeColor(d, out) {
  const sun = Env.sunDir;
  const [az, el] = azEl(d);
  const cs = d[0] * sun[0] + d[2] * sun[2]; // horizontal alignment with sun
  const warm = Math.pow(Math.max(0, cs * 0.5 + 0.5), 3);
  // enemy side (left) is thicker with smoke: greyer; right side luminous cream
  const smoke = smoothstep(0.1, -0.5, az);
  let r = lerp(0.62, 0.8, warm), g = lerp(0.6, 0.74, warm), b = lerp(0.56, 0.6, warm);
  r = lerp(r, 0.55, smoke * 0.45); g = lerp(g, 0.53, smoke * 0.45); b = lerp(b, 0.5, smoke * 0.45);
  const lift = 1 - 0.25 * smoothstep(0.0, 0.3, el);
  out[0] = r * lift; out[1] = g * lift; out[2] = b * lift;
  return out;
}

// Cloud density field in (az, el) space: towering cumulus columns rising from the smoke on the
// horizon, a heavy smoke-darkened ceiling, and a luminous break of muted blue above centre-left.
const TOWERS = [
  // az, width, top elevation, strength  (visible sky spans el 0..0.27, az -0.5..0.5)
  [-0.5, 0.13, 0.25, 1.0], [-0.33, 0.08, 0.17, 0.85], [-0.2, 0.06, 0.1, 0.6], [0.06, 0.07, 0.09, 0.55],
  [0.2, 0.07, 0.15, 0.8], [0.34, 0.07, 0.23, 1.0], [0.47, 0.09, 0.27, 1.0], [-0.72, 0.15, 0.28, 1.0],
];
function cloudDensity(az, el) {
  const u = az * 0.55, v = el * 1.1;
  const n1 = SK.t1.at(u * 0.9 + 0.13, v * 0.55 + 0.4), n2 = SK.t2.at(u * 1.9, v * 1.2), n3 = SK.t3.at(u * 4, v * 2.6);
  const detail = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  let d = 0;
  for (const [a0, w, top, k] of TOWERS) {
    const dx = (az - a0) / (w * (1 + 0.7 * smoothstep(0, top, el)));
    const t = top + 0.035 * (n2 + n3 * 0.7);
    d = Math.max(d, k * Math.exp(-dx * dx) * (1 - smoothstep(t - 0.035, t, el)) * (0.75 + 0.45 * detail));
  }
  // heavy ceiling of smoke-stained cloud
  const ceil = smoothstep(0.17, 0.3, el + 0.05 * n1 + 0.03 * n2) * (0.6 + 0.4 * smoothstep(-0.3, 0.3, az));
  d = Math.max(d, ceil * (0.8 + 0.4 * n1));
  // low smoke band along the horizon
  d = Math.max(d, (1 - smoothstep(0.0, 0.035 + 0.02 * n2, el)) * 0.7);
  // the luminous break above centre-left
  const gap = Math.exp(-Math.pow((az + 0.12) / 0.13, 2) - Math.pow((el - 0.19) / 0.05, 2));
  d -= gap * (0.9 + 0.3 * n2);
  return d + 0.12 * detail;
}

export function skyColor(d, out) {
  init();
  const [az, el] = azEl(d);
  const hz = [0, 0, 0];
  hazeColor(d, hz);
  const e = Math.max(0, el);
  // clear sky gradient
  const t = smoothstep(0.0, 0.2, e);
  let r = lerp(hz[0], lerp(BLUE[0], ZENITH[0], smoothstep(0.15, 0.35, e)), t);
  let g = lerp(hz[1], lerp(BLUE[1], ZENITH[1], smoothstep(0.15, 0.35, e)), t);
  let b = lerp(hz[2], lerp(BLUE[2], ZENITH[2], smoothstep(0.15, 0.35, e)), t);
  // clouds
  const dens = cloudDensity(az, el);
  const c = smoothstep(0.02, 0.32, dens);
  if (c > 0) {
    // light from the sun side (upper left): compare density offset toward the sun
    const sun = Env.sunDir;
    const [saz, sel] = azEl(sun);
    const du = clamp(saz - az, -1, 1) * 0.03, dv = 0.035;
    const dL = cloudDensity(az + du, el + dv);
    let lit = clamp(0.55 + (dens - dL) * 5, 0.22, 1.25);
    // underside darker, tops brighter
    lit *= lerp(0.8, 1.1, smoothstep(0.0, 0.2, e));
    const thick = smoothstep(0.2, 0.9, dens) * (0.6 + 0.4 * smoothstep(0.2, 0.6, e));
    let cr = lerp(GREY[0], CREAM[0], lit), cg = lerp(GREY[1], CREAM[1], lit), cb = lerp(GREY[2], CREAM[2], lit);
    cr = lerp(cr, DARK[0], thick * (1 - lit) * 0.8); cg = lerp(cg, DARK[1], thick * (1 - lit) * 0.8); cb = lerp(cb, DARK[2], thick * (1 - lit) * 0.8);
    // silver lining
    const edge = c * (1 - c) * 4 * smoothstep(0.4, 1, lit);
    cr += edge * 0.25; cg += edge * 0.22; cb += edge * 0.16;
    // fade into haze at horizon
    const hf = smoothstep(0.0, 0.05, e);
    cr = lerp(hz[0] * 1.02, cr, hf); cg = lerp(hz[1], cg, hf); cb = lerp(hz[2] * 0.98, cb, hf);
    r = lerp(r, cr, c); g = lerp(g, cg, c); b = lerp(b, cb, c);
  }
  // sunbeams slanting down through the break (from the hidden sun, upper left)
  {
    const ang = Math.atan2(el - 0.45, az + 0.95);
    const beam = Math.pow(0.5 + 0.5 * SK.t2.at(ang * 3.1, 0.37), 3);
    const gapMask = Math.exp(-Math.pow((az + 0.25) / 0.3, 2)) * smoothstep(0.01, 0.1, e) * (1 - smoothstep(0.2, 0.3, e));
    const k = beam * gapMask * 0.22;
    r += k; g += k * 0.92; b += k * 0.75;
  }
  // glow toward the hidden sun (upper left, out of frame)
  const sd = d[0] * Env.sunDir[0] + d[1] * Env.sunDir[1] + d[2] * Env.sunDir[2];
  const glow = Math.pow(Math.max(0, sd), 6) * 0.35;
  out[0] = r + glow; out[1] = g + glow * 0.9; out[2] = b + glow * 0.7;
  const k = 1.1; // sky exposure relative to scene
  out[0] *= k; out[1] *= k; out[2] *= k;
  return out;
}

export function renderSky(T, cam) {
  const W = T.W, H = T.H;
  const out = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (T.z[i] !== Infinity) continue;
      const d = cam.ray(x + 0.5, y + 0.5);
      skyColor(d, out);
      T.rgb[i * 3] = out[0]; T.rgb[i * 3 + 1] = out[1]; T.rgb[i * 3 + 2] = out[2];
      T.tag[i] = 0;
      if (T.g) { const G = T.g; G.oid[i] = 0; G.alb[i * 3] = out[0]; G.alb[i * 3 + 1] = out[1]; G.alb[i * 3 + 2] = out[2]; G.sun[i] = 1; G.amb[i] = 0; G.fog[i] = 0; }
    }
  }
}

// Aerial perspective, used by all lit surfaces.
const HZ = [0, 0, 0];
export function makeAtmo(cam) {
  const eye = cam.pos;
  return function atmo(F, r, g, b, dist) {
    const dx = (F.px - eye[0]) / dist, dy = (F.py - eye[1]) / dist, dz = (F.pz - eye[2]) / dist;
    hazeColor([dx, dy, dz], HZ);
    const ym = Math.max(0, (F.py + eye[1]) * 0.5);
    const sigma = 0.00042 + 0.0011 * Math.exp(-ym / 45);
    const tr = Math.exp(-dist * sigma);
    const k = 1.35 * (1 - tr);
    F.fog = 1 - tr; F.hr = HZ[0] * 1.35; F.hg = HZ[1] * 1.35; F.hb = HZ[2] * 1.35;
    F.r = r * tr + HZ[0] * k;
    F.g = g * tr + HZ[1] * k;
    F.b = b * tr + HZ[2] * k;
  };
}
