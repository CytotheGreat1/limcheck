// Ripelzen Guard advancing under fire — a procedural historical battle painting.
// A posed 3D scene serves as the painter's hidden reference (like a painter's lay figures);
// the picture itself is laid down stroke by stroke by src/painter.mjs.
//
// usage: node render.mjs [--w 3840] [--h 2160] [--out output/ripelzen-guard-battle.png] [--fast]
import fs from 'node:fs';
import path from 'node:path';
import { Camera } from './src/core/camera.mjs';
import { Target, drawMesh, ShadowMap, RS } from './src/core/raster.mjs';
import { Env } from './src/core/light.mjs';
import { norm } from './src/core/math.mjs';
import { initTextures } from './src/figure/materials.mjs';
import { buildSoldier } from './src/figure/soldier.mjs';
import { renderTerrain, initTerrainTex } from './src/world/terrain.mjs';
import { renderSky, makeAtmo } from './src/world/sky.mjs';
import { EYE } from './src/world/layout.mjs';
import { buildStory } from './src/scene/story.mjs';
import { finish } from './src/post.mjs';
import { buildEffects } from './src/scene/effects.mjs';
import { buildCountryside } from './src/world/countryside.mjs';
import { buildGrass } from './src/world/grass.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const W = +opt('w', 3840), H = +opt('h', 2160), SS = 1; // the painter reads its reference at canvas size
const OUT = opt('out', 'output/ripelzen-guard-battle.png');
const FAST = args.includes('--fast');
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const T0 = Date.now();

initTextures();
initTerrainTex();
const cam = new Camera({ pos: [0, EYE, 0], W: W * SS, H: H * SS, fovX: 55, horizon: 0.47 });
Env.cam = cam;
Env.sunDir = norm([-0.85, 0.5, 0.12]);
Env.skyCol = [0.21, 0.235, 0.28];
Env.sunI = 3.8;
Env.groundCol = [0.16, 0.14, 0.09];
Env.atmo = makeAtmo(cam);

// ---------------- scene ----------------
const story = buildStory({ fast: FAST });
Env.sunMask = story.sunMask;
Env.aoFn = story.aoFn;
Env.groundAO = story.groundAO;
const fx = buildEffects();
const land = buildCountryside();
const grass = buildGrass(5, { density: FAST ? 150 : 900 });
const items = story.items.concat(fx.items, land, grass); // {kind, build(lod) -> meshes, pos, radius, height}
log('scene items', items.length);

// view depth, screen bounds and LOD per item
const vis = [];
for (const it of items) {
  const v = cam.view(it.pos);
  if (v[2] < 0.3 && !it.always) continue;
  const z = Math.max(v[2], 0.3);
  const r = it.radius || 1.2;
  const sx = cam.cx + (cam.f * v[0]) / z, rpx = (cam.f * r) / z;
  if (sx + rpx < -50 || sx - rpx > cam.W + 50) continue;
  const sy = cam.cy - (cam.f * v[1]) / z;
  if (sy - rpx > cam.H + 50 || sy + rpx < -50) continue;
  const hpx = (cam.f * (it.height || 2.3)) / z;
  it.depth = z;
  it.lod = Math.min(2, Math.max(0.035, hpx / 2600));
  if (FAST) it.lod = Math.min(it.lod, 0.6);
  vis.push(it);
}
vis.sort((a, b) => a.depth - b.depth);
log('visible items', vis.length);

// ---------------- shadows ----------------
const casc = [
  { c: [-1.5, 0, 12], hw: 17, res: FAST ? 2048 : 8192, maxD: 30, bias: 0.006, radius: 1.6, off: 0.012 },
  { c: [6, 0, 85], hw: 75, res: FAST ? 1024 : 4096, maxD: 160, bias: 0.05, radius: 1.2, off: 0.05 },
];
Env.cascades = casc.map((c) => {
  const sm = new ShadowMap(Env.sunDir, c.c, c.hw, c.hw, c.res);
  return { sm, bias: c.bias, radius: c.radius, normalOffset: c.off, maxD: c.maxD, contains: (x, y, z) => sm.inside(x, y, z) };
});
{
  let n = 0;
  for (const it of vis) {
    if (it.noShadow) continue;
    const casters = Env.cascades.filter((c) => it.depth < c.maxD + 10);
    if (!casters.length) continue;
    const lod = Math.min(it.lod, 0.7);
    const meshes = it.build(lod);
    for (const m of meshes) {
      if (m.castShadow === false) continue;
      for (const c of casters) c.sm.drawMesh(m);
    }
    n++;
  }
  log('shadow casters', n);
}

// ---------------- colour pass ----------------
const T = new Target(cam.W, cam.H, { gbuf: true });
{
  let tris = 0;
  Env.focalOid = new Uint8Array(vis.length + 4);
  vis.forEach((it, k) => {
    RS.oid = k + 2;
    if (it.focal) Env.focalOid[k + 2] = 1;
    const meshes = it.build(it.lod);
    for (const m of meshes) { drawMesh(T, cam, m); tris += m.nt; }
  });
  log('figures + props rasterised, tris', tris);
}
renderTerrain(T, cam);
log('terrain');
renderSky(T, cam);
log('sky');
fx.smoke.render(T, cam, SS, W, H, log);
log('smoke');

// ---------------- effects + painting ----------------
const img = finish(T, cam, story, { W, H, SS, fast: FAST, log });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
img.save(OUT);
log('wrote', OUT);
