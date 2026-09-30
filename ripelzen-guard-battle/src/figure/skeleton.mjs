// Body proportions, pose description and skeleton solving (FK for trunk/head, IK for limbs).
import { Frame, add, sub, mul, madd, norm, cross, dot, len, perp, rotAxis, vlerp } from '../core/math.mjs';
import { ik2 } from './geom.mjs';

// Standing reference heights for a 1.80 m man (metres).
export const REF = {
  pelvisY: 0.94,
  chestY: 1.3,
  hipX: 0.088,
  thigh: 0.435,
  shin: 0.425,
  upper: 0.3,
  fore: 0.265,
  shoulderX: 0.172,
  shoulderY: 0.155, // above chest origin
  shoulderZ: -0.025,
  neckY: 0.215,
  neckZ: -0.035,
  headUp: 0.155,
  headFwd: 0.012,
};

export function makeBody(rng, over = {}) {
  const H = over.H ?? rng.gclip(1.8, 0.045, 2);
  const s = H / 1.8;
  return {
    H, s,
    breadth: over.breadth ?? rng.gclip(1.0, 0.04, 2),
    belly: over.belly ?? Math.max(0, rng.gclip(0.2, 0.3, 2)),
    neck: rng.gclip(1, 0.06, 2),
    ...over,
  };
}

// Pose: everything in world space. Required: pelvis (Frame at hip-joint centre), spine {bend,twist,side},
// head {nod,turn,tilt}, ankle[2], foot[2] (Frames at ankle, z toward toe, y up), knee[2] pole dirs,
// hand[2] {fr: Frame at wrist (z along fingers, y = back of hand), curl:[mcp,pip,dip], thumb}, elbow[2] pole dirs.
export function solveSkeleton(body, pose) {
  const s = body.s;
  const P = pose.pelvis;
  const sp = pose.spine || { bend: 0, twist: 0, side: 0 };
  // lumbar takes 35% of the rotation, thorax the rest
  const lum = P.yaw(sp.twist * 0.35).pitch(sp.bend * 0.4).roll(sp.side * 0.4);
  const lumO = P.p(0, 0.1 * s, 0);
  let chest = lum.yaw(sp.twist * 0.65).pitch(sp.bend * 0.6).roll(sp.side * 0.6);
  chest = chest.at(madd(madd(lumO, lum.y, 0.12 * s), chest.y, 0.14 * s));
  const hd = pose.head || { nod: 0, turn: 0, tilt: 0 };
  const neckBase = chest.p(0, REF.neckY * s, REF.neckZ * s);
  // neck takes part of head rotation
  const neckFr = chest.yaw(hd.turn * 0.5).pitch(hd.nod * 0.5 + (pose.neckLean || 0)).roll(hd.tilt * 0.5);
  let head = chest.yaw(hd.turn).pitch(hd.nod).roll(hd.tilt);
  const headO = madd(madd(neckBase, neckFr.y, REF.headUp * s * body.neck), head.z, REF.headFwd * s);
  head = head.at(headO);

  const sk = { body, s, pelvis: P, lumbar: lum, chest, head, neckBase, neckFr, pose };
  sk.hip = [P.p(-REF.hipX * s, 0, 0), P.p(REF.hipX * s, 0, 0)];
  sk.knee = []; sk.ankle = []; sk.foot = [];
  for (let i = 0; i < 2; i++) {
    const r = ik2(sk.hip[i], pose.ankle[i], REF.thigh * s, REF.shin * s, pose.knee[i]);
    sk.knee.push(r.mid);
    sk.ankle.push(r.end);
    sk.foot.push(pose.foot[i].at(r.end));
  }
  sk.shoulder = []; sk.elbow = []; sk.wrist = []; sk.hand = []; sk.reach = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const h = pose.hand[i];
    // shoulder elevation: raise joint a little when the hand is high
    let sh = chest.p(side * REF.shoulderX * s * body.breadth, REF.shoulderY * s, REF.shoulderZ * s);
    const up = dot(sub(h.fr.o, sh), chest.y);
    if (up > -0.2) sh = madd(sh, chest.y, Math.min(0.045, (up + 0.2) * 0.07) * s);
    if (h.shrug) sh = madd(sh, chest.y, h.shrug * s);
    sk.shoulder.push(sh);
    const r = ik2(sh, h.fr.o, REF.upper * s, REF.fore * s, pose.elbow[i]);
    sk.elbow.push(r.mid);
    sk.wrist.push(r.end);
    sk.reach.push(r.reach);
    sk.hand.push({ ...h, fr: h.fr.at(r.end) });
  }
  return sk;
}

// Hand frame helper. Builds a wrist frame for a hand whose palm grips a cylinder with axis dir D through G.
// approach: rough direction from the palm toward the axis. isLeft flips handedness (thumb side).
// Returns frame at wrist: z toward fingers, y = back of hand. x = y × z.
export function gripFrame(G, D, approach, towardFingers, s = 1, rCyl = 0.02) {
  const d = norm(D);
  let n = norm(perp(approach, d)); // palm -> axis
  let z = norm(perp(towardFingers, d));
  z = norm(perp(z, n));
  const y = mul(n, -1);
  const x = cross(y, z);
  // palm centre sits (rCyl + palm half thickness) from the axis
  const palm = madd(G, n, -(rCyl + 0.014 * s));
  const o = madd(palm, z, -0.055 * s);
  return new Frame(o, x, y, z);
}

// A relaxed/open hand frame from a wrist position, finger direction and back-of-hand direction.
export function handFrame(o, fingers, back) {
  const z = norm(fingers);
  const y = norm(perp(back, z));
  return new Frame(o, cross(y, z), y, z);
}
