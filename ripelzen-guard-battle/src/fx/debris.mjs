// Flying earth clods, turf chunks and splinters thrown up by shot, as small meshes.
import { Frame, add, sub, mul, madd, norm, cross, lerp, clamp, hex, rotAxis } from '../core/math.mjs';
import { gridSurface, mergeMeshes } from '../core/mesh.mjs';
import { noise3 } from '../core/rng.mjs';
import { S, resetS, shadeLit } from '../core/light.mjs';

const SOIL = hex('#3b2c1e'), SOIL2 = hex('#56412a'), TURF = hex('#4a5528');

function lump(c, r, stretch, dir, seed, nu = 7, nv = 5) {
  const fr = Frame.fromUpFwd(c, dir, Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
  return gridSurface(nu, nv, (u, v) => {
    const th = u * Math.PI * 2, ph = v * Math.PI;
    const sp = Math.sin(ph);
    const k = 1 + 0.45 * noise3(Math.cos(th) * 1.3 + seed, Math.cos(ph) * 1.3, Math.sin(th) * 1.3 - seed);
    return fr.p(r * sp * Math.cos(th) * k, r * stretch * Math.cos(ph) * k, r * sp * Math.sin(th) * k);
  }, { wrapU: true });
}

function soilMat(turf) {
  return {
    shade(F) {
      resetS(); S.wrap = 0.3;
      let c = turf && F.v < 0.3 ? TURF : F.ex > 0.5 ? SOIL2 : SOIL;
      F.tag = 8;
      shadeLit(F, c[0], c[1], c[2]);
    },
  };
}

// Spray of clods from an impact at p0. dirMain: dominant throw direction; spread; count; size.
export function earthSpray(rng, p0, dirMain, { count = 40, spread = 0.6, size = 0.05, reach = 2.5, height = 2.5, turf = 0.3 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rng.next(), 0.7);
    let d = norm([dirMain[0] + rng.gclip(0, spread), dirMain[1] + rng.gclip(0, spread * 0.6), dirMain[2] + rng.gclip(0, spread)]);
    const dist = reach * t;
    const c = [p0[0] + d[0] * dist, p0[1] + Math.max(0.03, d[1] * height * t * (1.2 - t * 0.6)), p0[2] + d[2] * dist];
    const r = size * (0.3 + rng.next() * rng.next() * 1.8) * (1.2 - t * 0.5);
    const isTurf = rng.chance(turf);
    const m = lump(c, r, 1 + rng.range(0.2, 1.4), d, rng.range(0, 50));
    m.ex.fill(rng.next());
    m.material = soilMat(isTurf);
    parts.push(m);
  }
  return parts;
}

// Grass tufts and soil kicked up at ground level (for canister strikes)
export function turfKick(rng, p0, dir, n = 6, size = 0.035) {
  return earthSpray(rng, p0, norm([dir[0], 1.6, dir[2]]), { count: n, spread: 0.5, size, reach: 0.35, height: 0.7, turf: 0.5 });
}
