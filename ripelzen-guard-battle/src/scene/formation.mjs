// The Ripelzen Guard battle line: three ranks advancing diagonally away from the viewer,
// each man individually posed. Story-specific figures (casualties, officers) are added by story.mjs.
import { Frame, add, sub, mul, madd, norm, lerp, clamp, smoothstep } from '../core/math.mjs';
import { Rng } from '../core/rng.mjs';
import { makeBody } from '../figure/skeleton.mjs';
import { randomFace, exprDefault } from '../figure/head.mjs';
import { marchBase, applyCarry, carryShoulder, carryPort, carryTrail, carryReady } from '../figure/poses.mjs';
import { height } from '../world/terrain.mjs';
import { L, A, fromLine, PHI } from '../world/layout.mjs';

export const FILE_SP = 0.64;
export const RANK_SP = 0.78;
const YAW_A = Math.atan2(A[0], A[2]); // facing direction yaw

export function groundFrame(s, a, yawJ = 0) {
  const [x, z] = fromLine(s, a);
  return Frame.fromYaw([x, height(x, z), z], YAW_A + yawJ);
}
export const ground = (x, z) => height(x, z);

// Generic marching guardsman with individual variation.
export function marcher(rng, s, a, o = {}) {
  const age = clamp(rng.gclip(0.45, 0.22), 0.05, 0.95);
  const body = makeBody(rng, o.body || {});
  const face = randomFace(rng, age);
  const G = groundFrame(s, a, (o.yaw ?? 0) + rng.gclip(0, 0.05));
  const phase = o.phase ?? rng.next();
  const lean = o.lean ?? rng.gclip(0.08, 0.035);
  const pose = marchBase(G, body, {
    phase, lean,
    stride: o.stride ?? rng.gclip(1.12, 0.07),
    stance: rng.gclip(0.1, 0.012),
    toeOut: rng.gclip(0.12, 0.05),
    armSwing: o.armSwing ?? rng.gclip(0.55, 0.2),
    nod: o.nod ?? rng.gclip(-lean * 0.5, 0.06),
    turn: o.turn ?? rng.gclip(0, 0.12),
    tilt: o.tilt ?? rng.gclip(0, 0.05),
    twist: o.twist ?? rng.gclip(0, 0.05),
    crouch: o.crouch,
    bend: o.bend,
    shuffle: o.shuffle,
    footX: o.footX, footZ: o.footZ, footYaw: o.footYaw,
  }, ground);
  let carry = o.carry;
  if (!carry) {
    const r = rng.next();
    carry = r < 0.72 ? 'shoulder' : r < 0.9 ? 'port' : r < 0.97 ? 'trail' : 'ready';
  }
  const carries = { shoulder: carryShoulder, port: carryPort, trail: carryTrail, ready: carryReady };
  applyCarry(pose, body, carries[carry], {
    carry: {
      tiltX: rng.gclip(0, 0.03), tiltZ: rng.gclip(0, 0.04), tiltY: rng.gclip(0, 0.08),
      dx: rng.gclip(0, 0.01), dy: rng.gclip(0, 0.02), dz: rng.gclip(0, 0.015), lpos: rng.gclip(0, 0.04),
      ...(o.carryOpt || {}),
    },
  });
  // expression: disciplined, individually varied
  const ex = exprDefault();
  const mood = o.mood || rng.pick(['set', 'set', 'set', 'grim', 'fear', 'tense', 'tired', 'angry']);
  applyMood(ex, mood, rng);
  ex.gazeX = rng.gclip(0, 0.4); ex.gazeY = rng.gclip(0, 0.3);
  pose.expr = ex;
  pose.plumeWind = madd(mul(A, -0.05), L, 0.03).map((v, i) => v + (i === 1 ? -0.01 : 0) + rng.gclip(0, 0.015));
  pose.slingSag = [0, -1, 0];
  const att = { wear: rng.range(0.1, 0.45), sling: rng.chance(0.85), swing: tailSwing(pose, rng) };
  return { body, face, pose, att, s, a, carry, mood };
}

export function applyMood(ex, mood, rng) {
  switch (mood) {
    case 'set': ex.brow = rng.gclip(-0.3, 0.2); ex.eyes = rng.gclip(0.85, 0.08); break;
    case 'grim': ex.brow = -0.8; ex.eyes = 0.7; ex.wide = 0.2; break;
    case 'fear': ex.brow = 0.6; ex.eyes = 1.15; ex.jaw = rng.range(0, 0.15); break;
    case 'tense': ex.brow = -0.5; ex.eyes = 0.9; ex.wide = 0.3; break;
    case 'tired': ex.brow = 0.1; ex.eyes = 0.55; ex.jaw = 0.1; break;
    case 'angry': ex.brow = -1; ex.eyes = 0.8; ex.jaw = rng.range(0, 0.3); ex.wide = 0.3; break;
    case 'shout': ex.brow = -0.9; ex.eyes = 0.9; ex.jaw = rng.range(0.6, 0.9); ex.wide = 0.5; break;
    case 'pain': ex.brow = 0.8; ex.eyes = 0.3; ex.jaw = 0.45; ex.wide = 0.7; break;
    case 'shock': ex.brow = 1; ex.eyes = 1.2; ex.jaw = 0.5; break;
    case 'dead': ex.brow = 0; ex.eyes = 0.15; ex.jaw = 0.25; break;
    default: break;
  }
}

function tailSwing(pose, rng) {
  // coat tails lag behind the stride and lift slightly
  const G = pose.G;
  return madd(mul(G.z, -0.03 - Math.abs(Math.sin(pose.phase * Math.PI * 2)) * 0.025), [0, 1, 0], 0.01).map((v) => v + rng.gclip(0, 0.006));
}

// Build the whole line (without story figures). Returns array of soldiers; `skip(file, rank)` lets
// the story remove men who are replaced by casualties.
export function buildLine(seed, { files = 380, sStart = 0.4, skip = () => false, mod = () => null } = {}) {
  const out = [];
  for (let f = 0; f < files; f++) {
    for (let r = 0; r < 3; r++) {
      if (skip(f, r)) continue;
      const rng = new Rng(seed * 7919 + f * 31 + r * 7 + 1);
      const s = sStart + f * FILE_SP + rng.gclip(0, 0.06) + r * 0.05;
      const a = r * RANK_SP + rng.gclip(0, 0.07) + wobble(s);
      const o = mod(f, r, rng) || {};
      const sol = marcher(rng, s + (o.ds || 0), a + (o.da || 0), o);
      sol.file = f; sol.rank = r;
      out.push(sol);
    }
  }
  return out;
}

// the line is not perfectly straight: gentle bows from terrain and casualties
export function wobble(s) {
  return 0.35 * Math.sin(s * 0.045) + 0.2 * Math.sin(s * 0.13 + 1.3) + (s > 60 ? (s - 60) * 0.012 : 0);
}
