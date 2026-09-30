// Morelian countryside heightfield, field patchwork and per-pixel column-marched terrain renderer.
import { clamp, lerp, smoothstep, hex, norm } from '../core/math.mjs';
import { fbm2, noise2, ridge2, hash2, NoiseTex } from '../core/rng.mjs';
import { S, resetS, shadeLit, Env } from '../core/light.mjs';
import { F, writeG, RS } from '../core/raster.mjs';
import { lineCoords, EYE } from './layout.mjs';

// ---------------- height ----------------
const sm = smoothstep;
function heightRaw(x, z) {
  const [s, a] = lineCoords(x, z);
  let h = 0;
  // gentle undulation everywhere
  h += 0.35 * fbm2(x * 0.025 + 3.1, z * 0.025 - 1.7, 3);
  h += 0.06 * noise2(x * 0.3, z * 0.3);
  // the ground rises along the line toward a crest ~150 m away, then falls away
  h += 5.0 * sm(-10, 150, s) * sm(-120, -20, a) - 4.0 * sm(170, 320, s) * sm(-60, 40, a);
  // ahead of the line: the field dips into a shallow hollow before the far enemy ridge
  h -= 3.5 * sm(10, 220, a) * (1 - sm(250, 520, a));
  h += 28 * sm(380, 900, a) + 14 * sm(900, 1500, a) * fbm2(x * 0.002, z * 0.002, 3);
  // behind (right): the pasture falls into a broad valley, then climbs to the village hill
  h -= 3.5 * sm(-25, -220, a) * (1 - sm(500, 1400, Math.hypot(x, z)));
  h += 2.0 * sm(0, -120, a) * fbm2(x * 0.008 + 7, z * 0.008, 3);
  const dv = Math.hypot(x - 1250, z - 2450);
  h += 95 * Math.exp(-(dv * dv) / (1000 * 1000));
  // distant hills all around
  const d = Math.hypot(x, z);
  h += sm(1200, 4000, d) * (90 * fbm2(x * 0.0005 + 2, z * 0.0005 - 5, 4) + 70);
  return h;
}
// Tiled cache of the heightfield at three resolutions (bilinear), filled lazily.
const LEVELS = [{ d: 0.125, R: 60 }, { d: 0.5, R: 400 }, { d: 4, R: 3000 }, { d: 24, R: 1e9 }];
const TS = 64;
const tiles = LEVELS.map(() => new Map());
function tileAt(lv, tx, tz) {
  const key = tx * 73856093 ^ tz * 19349663;
  const m = tiles[lv];
  let t = m.get(key);
  if (t && t.tx === tx && t.tz === tz) return t;
  const d = LEVELS[lv].d;
  const a = new Float32Array((TS + 1) * (TS + 1));
  for (let j = 0; j <= TS; j++) for (let i = 0; i <= TS; i++) a[j * (TS + 1) + i] = heightRaw((tx * TS + i) * d, (tz * TS + j) * d);
  t = { tx, tz, a };
  m.set(key, t);
  return t;
}
export function height(x, z) {
  const r = Math.max(Math.abs(x), Math.abs(z));
  let lv = 0;
  while (r > LEVELS[lv].R) lv++;
  const d = LEVELS[lv].d;
  const gx = x / d, gz = z / d;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const tx = Math.floor(ix / TS), tz = Math.floor(iz / TS);
  const t = tileAt(lv, tx, tz);
  const lx = ix - tx * TS, lz = iz - tz * TS;
  const fx = gx - ix, fz = gz - iz;
  const a = t.a, o = lz * (TS + 1) + lx;
  const h00 = a[o], h10 = a[o + 1], h01 = a[o + TS + 1], h11 = a[o + TS + 2];
  return h00 + (h10 - h00) * fx + (h01 - h00) * fz + (h00 - h10 - h01 + h11) * fx * fz;
}

export function heightNormal(x, z, e) {
  const hx = height(x + e, z) - height(x - e, z);
  const hz = height(x, z + e) - height(x, z - e);
  return norm([-hx, 2 * e, -hz]);
}

// ---------------- field patchwork ----------------
const CROP = {
  meadow: hex('#4a532a'),
  meadowDry: hex('#6b6a38'),
  wheat: hex('#a38c4a'),
  wheatPale: hex('#b59e5c'),
  stubble: hex('#8d7a4c'),
  plough: hex('#5a4630'),
  pasture: hex('#44562a'),
  fallow: hex('#6a5f3c'),
  soil: hex('#4c3b28'),
  trampled: hex('#5a4f32'),
  lane: hex('#7b6748'),
};
export { CROP };
// Irregular fields: jittered, rotated grid cells.
const FROT = 0.35;
export function fieldAt(x, z) {
  const c = Math.cos(FROT), s = Math.sin(FROT);
  let u = (x * c - z * s) / 140, v = (x * s + z * c) / 95;
  u += 0.25 * noise2(x * 0.004, z * 0.004);
  v += 0.25 * noise2(x * 0.004 + 9, z * 0.004);
  const iu = Math.floor(u), iv = Math.floor(v);
  const fu = u - iu, fv = v - iv;
  const id = hash2(iu, iv);
  const edge = Math.min(fu, 1 - fu, fv, 1 - fv); // distance to boundary in cell units
  return { id, edge, iu, iv, fu, fv };
}
function cropOf(id) {
  if (id < 0.22) return 'wheat';
  if (id < 0.32) return 'wheatPale';
  if (id < 0.5) return 'meadow';
  if (id < 0.62) return 'pasture';
  if (id < 0.74) return 'stubble';
  if (id < 0.84) return 'plough';
  if (id < 0.92) return 'fallow';
  return 'meadowDry';
}

// Farm lane: a curving dirt track behind the line, winding toward the village
export function laneDist(x, z) {
  // parametric curve: x = f(z)
  const cx = 9 + 0.12 * z + 14 * Math.sin(z * 0.012) + 0.00004 * z * z * 3;
  return Math.abs(x - cx);
}

const TX = { a: null, b: null, c: null };
export function initTerrainTex() {
  if (TX.a) return;
  TX.a = new NoiseTex(512, 8, 5, 11.3);
  TX.b = new NoiseTex(512, 16, 4, 5.9);
  TX.c = new NoiseTex(256, 32, 3, 2.2);
}

// Ground albedo + roughness info. dist used to fade high frequencies.
export function groundAlbedo(x, z, dist, out) {
  const [s, a] = lineCoords(x, z);
  const f = fieldAt(x, z);
  let crop = cropOf(f.id);
  // the ground the guard crosses: meadow trampled by the advance
  const near = Math.hypot(x, z) < 600;
  if (near && a > -30 && a < 25) crop = 'meadow';
  if (near && a >= 25 && a < 220 && s > -80 && s < 260) crop = 'wheat';
  if (near && a <= -30 && a > -160) crop = f.id < 0.5 ? 'pasture' : 'meadowDry';
  let col = CROP[crop];
  let r = col[0], g = col[1], b = col[2];
  const k1 = TX.a.at(x * 0.013, z * 0.013), k2 = TX.b.at(x * 0.07, z * 0.07);
  const fade = clamp(1 - dist / 90, 0, 1), fade2 = clamp(1 - dist / 25, 0, 1);
  const k3 = fade > 0 ? TX.c.at(x * 0.6, z * 0.6) * fade : 0;
  const k4 = fade2 > 0 ? TX.c.at(x * 3.1 + 0.3, z * 3.1) * fade2 : 0;
  let m = 1 + 0.16 * k1 + 0.12 * k2 + 0.14 * k3 + 0.18 * k4;
  r *= m; g *= m; b *= m;
  // colour drift: dry yellow vs lush green
  const dry = 0.5 + 0.5 * TX.a.at(x * 0.004 + 0.3, z * 0.004);
  r *= 1 + (dry - 0.5) * 0.3; b *= 1 - (dry - 0.5) * 0.2;
  // ploughed furrows / wheat rows
  if (crop === 'plough' || crop === 'stubble') {
    const rows = Math.sin((x * Math.cos(FROT) - z * Math.sin(FROT)) * 3.0);
    const k = 1 + 0.12 * rows * clamp(1 - dist / 400, 0, 1);
    r *= k; g *= k; b *= k;
  }
  // flattened wheat where the guard (and the shot) passed
  if (crop === 'wheat' || crop === 'wheatPale') {
    const flat = smoothstep(0.1, 0.5, TX.b.at(x * 0.02 + 3, z * 0.02)) * smoothstep(300, 0, a);
    r = lerp(r, r * 0.85, flat); g = lerp(g, g * 0.82, flat); b = lerp(b, b * 0.8, flat);
  }
  // trampled band along and behind the advancing line
  const tramp = smoothstep(-4, 1, a) * smoothstep(9, 2, a) * 0.8 + smoothstep(-40, -3, a) * smoothstep(1, -3, a) * 0.35;
  if (tramp > 0 && s > -20) {
    const t = tramp * (0.5 + 0.5 * TX.b.at(x * 0.15, z * 0.15));
    r = lerp(r, CROP.trampled[0], t); g = lerp(g, CROP.trampled[1], t); b = lerp(b, CROP.trampled[2], t);
    // bare soil patches
    const bare = smoothstep(0.35, 0.7, TX.c.at(x * 0.25, z * 0.25)) * t;
    r = lerp(r, CROP.soil[0], bare); g = lerp(g, CROP.soil[1], bare); b = lerp(b, CROP.soil[2], bare);
  }
  // lane
  const ld = laneDist(x, z);
  if (ld < 3.2 && z > 2) {
    const w = 1 - smoothstep(1.6, 3.2, ld + k2 * 0.4);
    const rut = 1 - 0.15 * Math.exp(-Math.pow((ld - 0.8) / 0.25, 2));
    r = lerp(r, CROP.lane[0] * rut, w); g = lerp(g, CROP.lane[1] * rut, w); b = lerp(b, CROP.lane[2] * rut, w);
  }
  // field boundary tone (hedge/verge shading far away)
  if (!near || a > 220 || a < -160) {
    const e = smoothstep(0.035, 0.0, f.edge);
    r *= 1 - e * 0.45; g *= 1 - e * 0.3; b *= 1 - e * 0.45;
  }
  out[0] = r; out[1] = g; out[2] = b;
  return crop;
}

// ---------------- renderer ----------------
// Marches each screen column through the heightfield and fills visible terrain pixels (z-tested).
export function renderTerrain(T, cam, { tMax = 9000 } = {}) {
  initTerrainTex();
  const W = T.W, H = T.H, f = cam.f, cx = cam.cx, cy = cam.cy;
  const eye = cam.pos[1];
  const ZB = T.z, RGB = T.rgb, TAG = T.tag;
  const alb = [0, 0, 0];
  const mat = { shade() {} };
  for (let px = 0; px < W; px++) {
    const dx = (px + 0.5 - cx) / f; // world x per unit forward
    let ymin = H; // lowest unfilled row +1 (we fill upward)
    let t = 0.3;
    let prevT = t, prevY = cy - (f * (height(dx * t, t) - eye)) / t;
    while (t < tMax && ymin > 0) {
      const step = Math.max(0.004, t * 0.0025);
      t += step;
      const h = height(dx * t, t);
      const y = cy - (f * (h - eye)) / t;
      if (y < ymin) {
        // fill rows from ymin-1 up to ceil(y)
        const yTop = Math.max(0, Math.ceil(y - 0.5));
        for (let py = ymin - 1; py >= yTop; py--) {
          // interpolate depth between prev and current sample by row
          const yc = py + 0.5;
          let k = prevY !== y ? (yc - prevY) / (y - prevY) : 1;
          k = k < 0 ? 0 : k > 1 ? 1 : k;
          const tz = prevT + (t - prevT) * k;
          const idx = py * W + px;
          if (tz >= ZB[idx]) continue;
          const wx = dx * tz, wz = tz;
          const wy = eye - ((yc - cy) * tz) / f;
          const e = Math.max(0.05, tz * 0.004);
          const n = heightNormal(wx, wz, e);
          F.x = px; F.y = py; F.z = tz;
          F.px = wx; F.py = wy; F.pz = wz;
          F.nx = n[0]; F.ny = n[1]; F.nz = n[2];
          const dist = Math.hypot(wx, wy - eye, wz);
          groundAlbedo(wx, wz, dist, alb);
          resetS();
          S.wrap = 0.35; S.sheen = 0.05;
          if (Env.groundAO) S.ao = Env.groundAO(wx, wz);
          shadeLit(F, alb[0], alb[1], alb[2]);
          ZB[idx] = tz;
          RGB[idx * 3] = F.r; RGB[idx * 3 + 1] = F.g; RGB[idx * 3 + 2] = F.b;
          TAG[idx] = 1;
          if (T.g) { RS.oid = 1; writeG(T, idx, F); }
        }
        ymin = yTop;
      }
      prevT = t; prevY = y;
    }
  }
}
