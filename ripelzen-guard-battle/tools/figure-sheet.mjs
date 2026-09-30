// Debug tool: renders one or more guardsmen on a neutral ground for checking the model against the reference.
// usage: node tools/figure-sheet.mjs out.png [W H] [mode]
import { Camera } from '../src/core/camera.mjs';
import { Target, drawMesh, ShadowMap } from '../src/core/raster.mjs';
import { Env, shadeLit, resetS } from '../src/core/light.mjs';
import { writePNG } from '../src/core/png.mjs';
import { Frame, norm, linToSrgb } from '../src/core/math.mjs';
import { gridSurface } from '../src/core/mesh.mjs';
import { Rng } from '../src/core/rng.mjs';
import { initTextures } from '../src/figure/materials.mjs';
import { makeBody } from '../src/figure/skeleton.mjs';
import { randomFace } from '../src/figure/head.mjs';
import { standPose, marchBase, applyCarry, carryShoulder, carryPort, carryTrail, carryReady } from '../src/figure/poses.mjs';
import { buildSoldier } from '../src/figure/soldier.mjs';

const out = process.argv[2] || 'sheet.png';
const W = +(process.argv[3] || 1600), H = +(process.argv[4] || 1000);
const mode = process.argv[5] || 'stand';
initTextures();
const SS = 2;
const cam = new Camera({ pos: [0, 1.25, mode === 'stand' ? -3.2 : -4.6], W: W * SS, H: H * SS, fovX: mode === 'stand' ? 42 : 48, horizon: 0.5 });
if (mode === 'face') Object.assign(cam, new Camera({ pos: [0.0, 1.66, -0.9], W: W * SS, H: H * SS, fovX: 30, horizon: 0.45 }));
Env.cam = cam;
Env.sunDir = norm([-0.6, 0.6, -0.5]);
if (process.env.ALBEDO) Env.debugAlbedo = true;
if (mode === 'face34') { Object.assign(cam, new Camera({ pos: [-0.95, 1.8, -0.75], yaw: 0.93, W: W * SS, H: H * SS, fovX: 30, horizon: 0.42 })); Env.sunDir = norm([-0.9, 0.45, 0.2]); }
const T = new Target(W * SS, H * SS);
const rng = new Rng(7);
const sols = [];
const single = mode === 'stand' || mode === 'face' || mode === 'face34';
const poses = single ? ['stand'] : ['shoulder', 'port', 'trail', 'ready'];
poses.forEach((pn, k) => {
  const r = rng.fork(k);
  const body = makeBody(r, { H: 1.8 });
  const face = randomFace(r, r.range(0.1, 0.8));
  const n = poses.length;
  const x = (k - (n - 1) / 2) * 1.1;
  const yaw = single ? Math.PI : Math.PI * 1.5 + 0.35;
  const G = Frame.fromYaw([x, 0, 0], yaw);
  let pose;
  if (pn === 'stand') pose = standPose(G, body, null);
  else {
    pose = marchBase(G, body, { phase: 0.15 + k * 0.23, lean: 0.07 }, null);
    applyCarry(pose, body, { shoulder: carryShoulder, port: carryPort, trail: carryTrail, ready: carryReady }[pn]);
  }
  sols.push({ body, face, pose, att: { wear: 0.2 } });
});
const t0 = Date.now();
const meshes = [];
for (const s of sols) meshes.push(...buildSoldier(s, 1));
console.log('meshes', meshes.length, 'tris', meshes.reduce((a, m) => a + m.nt, 0), 'build ms', Date.now() - t0);
const ground = gridSurface(10, 10, (u, v) => [(u - 0.5) * 20, 0, (v - 0.5) * 20], { flip: true });
ground.material = { shade(F) { resetS(); shadeLit(F, 0.18, 0.17, 0.13); } };
const sm = new ShadowMap(Env.sunDir, [0, 1, 0], 4, 4, 4096);
for (const m of meshes) sm.drawMesh(m);
Env.cascades = process.env.NOSHADOW ? [] : [{ sm, contains: () => true, bias: 0.004, radius: 1.5, normalOffset: 0.006 }];
const t1 = Date.now();
for (const m of meshes) drawMesh(T, cam, m);
drawMesh(T, cam, ground);
console.log('raster ms', Date.now() - t1);
const rgb = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  for (let c = 0; c < 3; c++) {
    let acc = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const i = ((y * SS + dy) * W * SS + x * SS + dx);
      acc += T.z[i] === Infinity ? [0.3, 0.3, 0.32][c] : T.rgb[i * 3 + c];
    }
    let v = acc / (SS * SS);
    if (!process.env.ALBEDO) v = v / (1 + v * 0.35) * 1.1;
    rgb[(y * W + x) * 3 + c] = Math.round(linToSrgb(v) * 255);
  }
}
writePNG(out, W, H, rgb);
