// Foreground meadow: individual grass blades and weeds (merged into chunk meshes), trampled where the
// guard has marched, tall in the untouched patches.
import { Mesh } from '../core/mesh.mjs';
import { lerp, clamp, smoothstep, hex } from '../core/math.mjs';
import { Rng, fbm2, noise2 } from '../core/rng.mjs';
import { S, resetS, shadeLit } from '../core/light.mjs';
import { height } from './terrain.mjs';
import { toLine } from './layout.mjs';

const G1 = hex('#4b5a24'), G2 = hex('#6d6a32'), G3 = hex('#8b7c45'), G4 = hex('#3a4a1c');

function grassMat() {
  return {
    shade(F) {
      resetS();
      S.wrap = 0.5; S.trans = 0.25; S.twoSided = true; S.sheen = 0.08;
      const k = F.ex; // colour mix param
      let c0 = k < 0.33 ? G4 : k < 0.66 ? G1 : G2;
      let c1 = k < 0.5 ? G2 : G3;
      const t = F.v;
      const r = lerp(c0[0], c1[0], t * 0.7), g = lerp(c0[1], c1[1], t * 0.7), b = lerp(c0[2], c1[2], t * 0.7);
      S.ao = 0.35 + 0.65 * Math.pow(t, 0.7);
      F.tag = 1;
      shadeLit(F, r, g, b);
    },
  };
}

// region: function(x,z)->bool visible; zmin..zmax depth; xspan per depth
export function buildGrass(seed, { zMin = 1.2, zMax = 17, density = 700, halfFov = 0.52, chunk = 2.0, exclude = null } = {}) {
  const rng = new Rng(seed);
  const chunks = new Map();
  const mat = grassMat();
  const add = (cx, cz, blade) => {
    const key = cx + ',' + cz;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(blade);
  };
  // iterate over depth bands
  for (let z = zMin; z < zMax; z += 0.25) {
    const w = (z + 0.25) * halfFov * 2.1;
    const area = w * 0.25;
    const n = Math.round(area * density * (z < 4 ? 1 : lerp(1, 0.55, (z - 4) / (zMax - 4))));
    for (let i = 0; i < n; i++) {
      const bz = z + rng.next() * 0.25;
      const bx = (rng.next() - 0.5) * w;
      if (exclude && exclude(bx, bz)) continue;
      const [s, a] = toLine(bx, bz);
      const tall = smoothstep(-0.1, 0.35, fbm2(bx * 0.35 + 3, bz * 0.35, 3));
      const tramp = smoothstep(-2.5, 0.5, a) * smoothstep(3.5, 1.0, a) * (s > 3 ? 1 : 0) + 0.4 * smoothstep(-2, -0.5, a) * smoothstep(0.5, -0.5, a);
      if (rng.chance(tramp * 0.2)) continue;
      const h = (0.07 + 0.35 * tall * rng.next() + 0.06 * rng.next()) * (1 - tramp * 0.55);
      const lean = 0.15 + tramp * 1.1 + rng.next() * 0.35;
      const dir = rng.range(0, Math.PI * 2);
      add(Math.floor(bx / chunk), Math.floor(bz / chunk), { x: bx, z: bz, h, lean, dir, w: rng.range(0.003, 0.0065) * (1 + tall * 0.3), col: rng.next(), bend: rng.range(0.3, 1.2) });
    }
  }
  const items = [];
  for (const [key, blades] of chunks) {
    const nb = blades.length;
    const SEG = 3;
    const m = new Mesh(nb * (SEG + 1) * 2, nb * SEG * 2);
    let vi = 0, ti = 0;
    let cx = 0, cz = 0;
    for (const b of blades) {
      const gy = height(b.x, b.z) - 0.01;
      const dx = Math.cos(b.dir), dz = Math.sin(b.dir);
      const px = -dz, pz = dx; // width direction
      const base = vi;
      for (let j = 0; j <= SEG; j++) {
        const t = j / SEG;
        const ang = b.lean * (0.3 + t * b.bend);
        const hx = Math.sin(ang) * b.h * t, hy = Math.cos(ang) * b.h * t;
        const x = b.x + dx * hx, y = gy + hy, zz = b.z + dz * hx;
        const ww = b.w * (1 - t * 0.9);
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          m.pos[vi * 3] = x + px * ww * sgn; m.pos[vi * 3 + 1] = y; m.pos[vi * 3 + 2] = zz + pz * ww * sgn;
          // normal: facing sideways, tilted up for softer lighting
          m.nrm[vi * 3] = -dx * 0.5; m.nrm[vi * 3 + 1] = 0.85; m.nrm[vi * 3 + 2] = -dz * 0.5;
          m.tan[vi * 3] = px; m.tan[vi * 3 + 2] = pz;
          m.uv[vi * 2] = sgn < 0 ? 0 : 1; m.uv[vi * 2 + 1] = t;
          m.ex[vi] = b.col;
          vi++;
        }
      }
      for (let j = 0; j < SEG; j++) {
        const a0 = base + j * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        m.idx[ti * 3] = a0; m.idx[ti * 3 + 1] = a1; m.idx[ti * 3 + 2] = b0; ti++;
        m.idx[ti * 3] = a1; m.idx[ti * 3 + 1] = b1; m.idx[ti * 3 + 2] = b0; ti++;
      }
      cx += b.x; cz += b.z;
    }
    m.cull = false;
    m.material = mat;
    cx /= nb; cz /= nb;
    items.push({ kind: 'grass', pos: [cx, height(cx, cz) + 0.2, cz], radius: 1.6, height: 0.5, build: () => [m], noShadow: true, lodFixed: true });
  }
  return items;
}
