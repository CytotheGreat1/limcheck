// Authoring helper for arbitrary full-body poses + the dramatic pose library
// (canister casualties, musket-ball casualties, officers, helpers, the fallen).
import { Frame, add, sub, mul, madd, norm, cross, dot, len, perp, rotAxis, vlerp, lerp, clamp, smoothstep } from '../core/math.mjs';
import { REF, gripFrame, handFrame } from './skeleton.mjs';
import { musketFrame, musketAxis } from './equipment.mjs';
import { exprDefault } from './head.mjs';
import { placeFoot, chestOf } from './poses.mjs';

const HAND_REST = [0.35, 0.5, 0.3];

// spec (see story): pelvis {p:[x,h,z] G-local, pitch, roll, yaw}, spine, head,
// feet [{p:[x,z], lift, pitch, yaw} | {ankle:[..], fr: Frame}], knees [dir G-local],
// hands [{p:[x,y,z] chest-local, f:[..] fingers dir chest-local, b:[..] back dir, curl, thumb} | {grip:{...}} | {world:{fr}}],
// elbows [dir chest-local]
export function bodyPose(G, body, spec, ground) {
  const s = body.s;
  const pose = { expr: spec.expr || exprDefault(), G, phase: 0, armSwing: 0 };
  const pp = spec.pelvis;
  let P = G.yaw(pp.yaw || 0).pitch(pp.pitch || 0).roll(pp.roll || 0);
  if (pp.pitch2) P = P.pitch(pp.pitch2);
  const po = G.p(pp.p[0] * s, 0, pp.p[2] * s);
  const gy = ground ? ground(po[0], po[2]) : G.o[1];
  po[1] = gy + pp.p[1] * s;
  pose.pelvis = P.at(po);
  pose.spine = spec.spine || { bend: 0, twist: 0, side: 0 };
  pose.head = spec.head || { nod: 0, turn: 0, tilt: 0 };
  // feet
  pose.foot = []; pose.ankle = [];
  for (let i = 0; i < 2; i++) {
    const f = spec.feet[i];
    let fr;
    if (f.fr) fr = f.fr;
    else {
      const wp = G.p(f.p[0] * s, 0, f.p[1] * s);
      const g2 = ground ? ground(wp[0], wp[2]) : G.o[1];
      fr = placeFoot(f.G || G, s, f.p[0] * s, f.p[1] * s, f.pitch || 0, f.yaw || 0, g2 - 0.01 * s + (f.sink || 0), (f.lift || 0) * s);
      if (f.roll) fr = fr.roll(f.roll);
    }
    pose.foot.push(fr);
    pose.ankle.push(fr.o);
  }
  pose.knee = (spec.knees || [[-0.15, 0, 1], [0.15, 0, 1]]).map((k) => norm(G.d(k[0], k[1], k[2])));
  // chest for hand placement
  const C = chestOf(pose, body);
  pose.C = C;
  pose.hand = [];
  for (let i = 0; i < 2; i++) {
    const h = spec.hands[i];
    const side = i === 0 ? -1 : 1;
    if (h.fr) { pose.hand.push({ curl: HAND_REST, thumb: 0.4, ...h }); continue; }
    const o = C.p(h.p[0] * s, h.p[1] * s, h.p[2] * s);
    const fr = handFrame(o, C.d(...(h.f || [0, -1, 0])), C.d(...(h.b || [side, 0, 0])));
    pose.hand.push({ fr, curl: h.curl || HAND_REST, thumb: h.thumb ?? 0.4, spread: h.spread ?? 0.05 });
  }
  pose.elbow = (spec.elbows || [[-0.7, -0.3, -1], [0.7, -0.3, -1]]).map((e) => norm(C.d(...e)));
  return pose;
}

// Musket attached so that a given hand grips it at distance d along the musket.
export function musketInHand(handFr, d, dir, topHint, s) {
  // palm grip point approximately 0.07 in front of wrist and 0.03 below palm
  const g = madd(madd(handFr.o, handFr.z, 0.075 * s), handFr.y, -0.035 * s);
  const D = norm(dir);
  const butt = madd(g, D, -d);
  const fr = musketFrame(butt, D, topHint);
  return fr.at(madd(fr.o, fr.y, 0.012));
}
// Hand frame gripping musket at d
export function gripOn(mfr, d, approach, fingers, s, r = 0.02) {
  return gripFrame(musketAxis(mfr, d), mfr.z, approach, fingers, s, r);
}

// ------------- canister casualties -------------

// Thrown violently backward, musket slipping from the hand.
export function thrownBack(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.8, -0.28], pitch: -0.62, roll: o.roll ?? 0.12, yaw: o.yaw ?? 0.15 },
    spine: { bend: -0.15, twist: 0.25, side: 0.1 },
    head: { nod: 0.55, turn: -0.2, tilt: 0.2 },
    feet: [
      { p: [-0.12, 0.25], pitch: -0.45 },
      { p: [0.1, 0.48], pitch: 0.3, lift: 0.3 },
    ],
    knees: [[-0.2, 0.2, 1], [0.1, 0.4, 1]],
    hands: [
      { p: [-0.32, 0.25, 0.42], f: [-0.2, 0.3, 1], b: [-0.3, 1, 0], curl: [0.35, 0.45, 0.25], spread: 0.08 },
      { p: [0.3, 0.12, 0.45], f: [0.2, 0.1, 1], b: [0.3, 1, 0], curl: [0.3, 0.4, 0.2], spread: 0.2 },
    ],
    elbows: [[-1, -0.3, -0.2], [1, -0.4, -0.2]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.55, brow: 0.9, eyes: 0.5, wide: 0.4 };
  // musket slipping out of the right hand, rotating away
  const h = pose.hand[1].fr;
  const dir = norm(add(G.d(0.3, 0.9, 0.5), [0, 0, 0]));
  // the musket has left his grip: tumbling away forward and down, clear of the hand
  {
    // falling muzzle-first past his knees, just beyond the open fingers
    const md = norm(G.d(0.35, -0.55, 0.75));
    const g0 = madd(h.o, G.d(0.12, -0.25, 0.2), s);
    pose.musket = musketFrame(madd(g0, md, -0.6), md, rotAxis(G.y, md, 0.9));
  }
  pose.plumeWind = G.d(0, -0.02, 0.06);
  pose.boxSwing = { axis: G.x, angle: -0.6 };
  pose.tailSwing = G.d(0, -0.02, 0.1);
  return pose;
}

// Collapsing sideways into the neighbour (side = +1 toward his right)
export function collapseSide(G, body, ground, side = 1, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [side * 0.12, 0.62, 0.02], pitch: 0.2, roll: side * 0.5, yaw: side * 0.2 },
    spine: { bend: 0.35, twist: side * 0.2, side: side * 0.35 },
    head: { nod: 0.5, turn: side * 0.3, tilt: side * 0.5 },
    feet: [
      { p: [-0.18, 0.1], pitch: 0.1, yaw: -0.3, roll: side * 0.2 },
      { p: [0.16, -0.15], pitch: 0.55, yaw: 0.3 },
    ],
    knees: [[-0.4, 0, 1], [0.5, 0, 1]],
    hands: [
      side > 0
        ? { p: [-0.12, -0.52, 0.18], f: [0, -1, 0.3], b: [-1, 0, 0.2], curl: [0.3, 0.4, 0.2] }
        : { p: [-0.55, 0.05, 0.12], f: [-0.9, 0.2, 0.3], b: [0, 1, 0], curl: [0.5, 0.6, 0.3] },
      side > 0
        ? { p: [0.55, 0.05, 0.12], f: [0.9, 0.2, 0.3], b: [0, 1, 0], curl: [0.5, 0.6, 0.3] }
        : { p: [0.12, -0.52, 0.18], f: [0, -1, 0.3], b: [1, 0, 0.2], curl: [0.3, 0.4, 0.2] },
    ],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.3, brow: 0.6, eyes: 0.35, wide: 0.5 };
  // musket falling across the body
  const C = pose.C;
  pose.musket = musketFrame(C.p(-0.3 * side * s, -1.0 * s, 0.35 * s), norm(C.d(side * 0.8, 0.45, 0.3)), C.z);
  pose.boxSwing = { axis: G.z, angle: side * 0.5 };
  return pose;
}

// Dropping suddenly onto one knee
export function dropKnee(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0.02, 0.5, -0.1], pitch: 0.35, roll: -0.12, yaw: 0.1 },
    spine: { bend: 0.55, twist: -0.15, side: 0.1 },
    head: { nod: 0.45, turn: 0.2, tilt: -0.15 },
    feet: [
      { p: [-0.12, 0.38], pitch: 0 },
      { fr: null, p: [0.12, -0.48], pitch: 1.35, lift: 0.0 },
    ],
    knees: [[-0.1, 0.3, 1], [0.1, -0.6, 1]],
    hands: [
      { p: [-0.1, -0.62, 0.42], f: [0, -1, 0.2], b: [-0.3, 0, -1], curl: [0.35, 0.45, 0.25], spread: 0.08 },
      { p: [0.2, -0.28, 0.32], f: [-0.3, -0.5, 0.5], b: [1, 0.3, 0], curl: [0.9, 1.1, 0.6] },
    ],
    elbows: [[-0.6, -0.2, -1], [1, -0.2, -0.5]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.35, brow: 0.8, eyes: 0.3, wide: 0.7 };
  // musket butt on the ground, barrel leaning away, loosely held by right hand
  const gp = G.p(0.32 * s, 0, 0.5 * s);
  gp[1] = (ground ? ground(gp[0], gp[2]) : G.o[1]) + 0.06;
  pose.musket = musketFrame(gp, norm(G.d(0.25, 1, 0.35)), G.d(-1, 0, 0));
  const hr = gripOn(pose.musket, 0.62, G.d(-1, 0, -0.3), G.d(-0.5, -0.2, -1), s, 0.018);
  pose.hand[1] = { fr: hr, curl: [0.8, 1.0, 0.6], thumb: 0.7 };
  return pose;
}

// Twisting as the bearskin is knocked loose (bearskin flies free)
export function twistHatLoose(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0.05, 0.86, -0.1], pitch: -0.12, roll: 0.15, yaw: 0.45 },
    spine: { bend: -0.1, twist: 0.7, side: 0.2 },
    head: { nod: -0.35, turn: 0.55, tilt: 0.35 },
    feet: [
      { p: [-0.2, 0.22], pitch: -0.2, yaw: -0.4 },
      { p: [0.18, -0.25], pitch: 0.5, lift: 0.08, yaw: 0.5 },
    ],
    knees: [[-0.4, 0.1, 1], [0.3, 0, 1]],
    hands: [
      { p: [-0.42, 0.28, 0.1], f: [-0.4, 0.8, 0.2], b: [-1, 0, -0.3], curl: [0.3, 0.4, 0.2], spread: 0.08 },
      { p: [0.3, -0.2, 0.25], f: [0, -0.3, 1], b: [1, 0, 0], curl: [0.9, 1.1, 0.6] },
    ],
    elbows: [[-1, -0.3, -0.3], [1, -0.5, -0.8]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.4, brow: 0.7, eyes: 0.6, wide: 0.3 };
  // musket still in right hand, swinging low
  const h = pose.hand[1].fr;
  pose.musket = musketInHand(h, 0.45, norm(pose.C.d(-0.2, 0.3, 1)), pose.C.y, s);
  return pose;
}

// Falling face-forward into the grass
export function fallForward(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.62, 0.35], pitch: 1.05, roll: 0.1, yaw: -0.1 },
    spine: { bend: 0.25, twist: -0.1, side: 0.05 },
    head: { nod: -0.5, turn: -0.15, tilt: 0.1 },
    feet: [
      { p: [-0.1, -0.25], pitch: 1.1, lift: 0.02 },
      { p: [0.14, 0.12], pitch: 0.4, lift: 0.0 },
    ],
    knees: [[-0.1, -0.2, 1], [0.1, -0.4, 1]],
    hands: [
      { p: [-0.25, 0.25, 0.55], f: [-0.1, -0.2, 1], b: [0, 1, 0.3], curl: [0.3, 0.35, 0.2], spread: 0.08 },
      { p: [0.25, 0.15, 0.55], f: [0.1, -0.3, 1], b: [0, 1, 0.3], curl: [0.3, 0.4, 0.2], spread: 0.08 },
    ],
    elbows: [[-1, -0.5, 0], [1, -0.5, 0]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.3, brow: 0.3, eyes: 0.2 };
  pose.musket = null; // dropped, placed separately
  pose.boxSwing = { axis: G.x, angle: 0.8 };
  return pose;
}

// Wounded, clutching his side, trying to stay upright (musket as support)
export function clutchSide(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.84, 0], pitch: 0.2, roll: 0.1, yaw: -0.1 },
    spine: { bend: 0.5, twist: 0.2, side: 0.3 },
    head: { nod: 0.2, turn: 0.35, tilt: 0.25 },
    feet: [
      { p: [-0.18, 0.2], pitch: 0, yaw: -0.2 },
      { p: [0.14, -0.2], pitch: 0.2, yaw: 0.1 },
    ],
    knees: [[-0.2, 0, 1], [0.2, 0, 1]],
    hands: [
      { p: [-0.25, -0.1, 0.35], f: [0.2, 0.9, 0.2], b: [-1, 0, 0.2], curl: [0.9, 1.1, 0.6] },
      { p: [0.1, -0.2, 0.12], f: [-0.6, -0.3, 0.3], b: [0.2, 0, 1], curl: [0.5, 0.7, 0.4], spread: 0.15 },
    ],
    elbows: [[-1, -0.3, -0.4], [1, -0.4, -0.2]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.15, brow: 1, eyes: 0.35, wide: 0.8 };
  // musket grounded to the left, gripped by left hand
  const gp = G.p(-0.42 * s, 0, 0.45 * s);
  gp[1] = (ground ? ground(gp[0], gp[2]) : G.o[1]) + 0.05;
  pose.musket = musketFrame(gp, norm(G.d(0.05, 1, -0.12)), G.d(-1, 0, 0));
  pose.hand[0] = { fr: gripOn(pose.musket, 0.95 * s, G.d(1, 0, -0.2), G.d(0.2, 0.1, 1).map((v) => -v), s, 0.016), curl: [1, 1.2, 0.7], thumb: 0.8 };
  return pose;
}

// Struck by a ball: recoils backward (upright)
export function recoil(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.9, -0.1], pitch: -0.22, roll: -0.08, yaw: 0.1 },
    spine: { bend: -0.3, twist: 0.2, side: -0.1 },
    head: { nod: -0.5, turn: 0.2, tilt: -0.2 },
    feet: [
      { p: [-0.1, 0.15], pitch: -0.2 },
      { p: [0.12, -0.3], pitch: 0.3, lift: 0.02 },
    ],
    hands: [
      { p: [-0.3, 0.42, 0.25], f: [-0.3, 0.8, 0.4], b: [-1, 0, 0], curl: [0.35, 0.45, 0.25], spread: 0.08 },
      { p: [0.05, 0.05, 0.14], f: [-0.5, 0.2, 0.2], b: [0.2, 0, 1], curl: [0.6, 0.8, 0.4] },
    ],
    elbows: [[-1, -0.6, -0.2], [1, -0.6, -0.3]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.5, brow: 0.9, eyes: 0.6, wide: 0.6 };
  pose.musket = null;
  return pose;
}

// Slowly collapsing: knees buckling
export function sag(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.66, -0.12], pitch: 0.15, roll: -0.15, yaw: 0 },
    spine: { bend: 0.45, twist: 0, side: -0.2 },
    head: { nod: 0.6, turn: -0.1, tilt: -0.3 },
    feet: [
      { p: [-0.14, 0.12], pitch: 0.1, yaw: -0.2 },
      { p: [0.14, -0.1], pitch: 0.4, yaw: 0.3 },
    ],
    knees: [[-0.3, 0, 1], [0.3, 0, 1]],
    hands: [
      { p: [-0.2, -0.55, 0.15], f: [0, -1, 0.2], b: [-1, 0, 0], curl: [0.4, 0.5, 0.3] },
      { p: [0.08, -0.15, 0.2], f: [-0.4, -0.2, 0.4], b: [0.4, 0, 1], curl: [0.5, 0.6, 0.3] },
    ],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.25, brow: 0.5, eyes: 0.25 };
  pose.musket = null;
  return pose;
}

// Lying on the ground (prone or supine). head direction given by G.z
export function lying(G, body, ground, { supine = false, curl = 0.3, armsOut = 0.5, legBend = 0.2 } = {}) {
  const s = body.s;
  // pelvis frame: y (spine up) points along G.z, z (front) points down (prone) or up (supine)
  const up = G.z, front = supine ? [0, 1, 0] : [0, -1, 0];
  let P = Frame.fromUpFwd([0, 0, 0], up, front);
  P = P.rot(up, curl * 0.2);
  const po = G.p(0, 0, 0);
  po[1] = (ground ? ground(po[0], po[2]) : G.o[1]) + 0.13 * s;
  const pose = { expr: { ...exprDefault(), eyes: supine ? 0.15 : 0.1, jaw: 0.2 }, G, phase: 0, armSwing: 0 };
  pose.pelvis = P.at(po);
  pose.spine = { bend: supine ? -0.1 : 0.05, twist: curl * 0.5, side: curl };
  pose.head = { nod: supine ? 0.3 : -0.2, turn: supine ? 0.6 : 1.1, tilt: 0.3 };
  // legs extend back along -G.z
  const lx = P.x;
  pose.ankle = []; pose.foot = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    let a = madd(madd(po, G.z, -(0.8 - legBend * 0.25 * (i + 1)) * s), lx, side * (0.14 + legBend * 0.1 * i) * s);
    const gy = ground ? ground(a[0], a[2]) : G.o[1];
    a[1] = gy + 0.08 * s;
    const toes = supine ? [0, 1, 0] : [0, -1, 0];
    const fr = Frame.fromFwdUp(a, norm(add(toes, mul(G.z, -0.4))), mul(G.z, 1));
    pose.ankle.push(a); pose.foot.push(fr.yaw(side * 0.3));
  }
  pose.knee = [norm(add(front, mul(lx, -0.3))), norm(add(front, mul(lx, 0.3)))];
  const C = chestOf(pose, body);
  pose.C = C;
  pose.hand = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const out = i === 0 ? armsOut : armsOut * 0.4;
    let hp = C.p(side * (0.3 + out * 0.3) * s, (0.15 * out - 0.35 * (1 - out)) * s, 0);
    const gy = ground ? ground(hp[0], hp[2]) : G.o[1];
    hp[1] = gy + 0.04 * s;
    const fr = handFrame(hp, C.d(side * 0.3, out, 0), supine ? [0, -1, 0] : [0, 1, 0]);
    pose.hand.push({ fr, curl: [0.4, 0.5, 0.3], thumb: 0.3 });
  }
  pose.elbow = [norm(C.d(-1, 0, supine ? 1 : -1)), norm(C.d(1, 0, supine ? 1 : -1))];
  pose.musket = null;
  return pose;
}

// Rising with the musket as a crutch (one knee down, both hands on the barrel)
export function riseOnMusket(G, body, ground, o = {}) {
  const s = body.s;
  const gp = G.p(0.05 * s, 0, 0.42 * s);
  gp[1] = (ground ? ground(gp[0], gp[2]) : G.o[1]) + 0.05;
  const mfr = musketFrame(gp, norm(G.d(0.02, 1, -0.2)), G.d(0, 0, 1));
  const pose = bodyPose(G, body, {
    pelvis: { p: [0.02, 0.52, -0.12], pitch: 0.42, roll: 0.1, yaw: 0.05 },
    spine: { bend: 0.4, twist: 0.05, side: -0.1 },
    head: { nod: -0.1, turn: 0.15, tilt: 0.15 },
    feet: [
      { p: [-0.14, 0.3], pitch: 0 },
      { p: [0.13, -0.52], pitch: 1.35 },
    ],
    knees: [[-0.1, 0.3, 1], [0.1, -0.6, 1]],
    hands: [{ p: [0, 0, 0] }, { p: [0, 0, 0] }],
  }, ground);
  pose.musket = mfr;
  pose.hand[0] = { fr: gripOn(mfr, 1.12 * s, G.d(0, 0, 1), G.d(1, 0, 0), s, 0.014), curl: [1, 1.2, 0.7], thumb: 0.8 };
  pose.hand[1] = { fr: gripOn(mfr, 0.98 * s, G.d(0, 0, 1), G.d(-1, 0, 0), s, 0.015), curl: [1, 1.2, 0.7], thumb: 0.8 };
  pose.elbow = [norm(G.d(-1, -0.5, -0.3)), norm(G.d(1, -0.5, -0.3))];
  pose.expr = { ...exprDefault(), jaw: 0.2, brow: 0.9, eyes: 0.5, wide: 0.6 };
  return pose;
}

// Crouching beside a fallen comrade: one knee down, a hand on the comrade, musket upright in the other hand
export function crouchBeside(G, body, ground, touch, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.5, -0.05], pitch: 0.25, roll: 0.05, yaw: 0 },
    spine: { bend: 0.45, twist: o.twist ?? 0.2, side: 0.1 },
    head: { nod: o.nod ?? 0.2, turn: o.turn ?? 0.3, tilt: 0.1 },
    feet: [
      { p: [-0.16, 0.35], pitch: 0.05 },
      { p: [0.14, -0.45], pitch: 1.3 },
    ],
    knees: [[-0.2, 0.3, 1], [0.1, -0.6, 1]],
    hands: [{ p: [-0.3, -0.25, 0.3] }, { p: [0.3, -0.3, 0.3], f: [0, -1, 0.3], b: [1, 0, 0] }],
  }, ground);
  // right hand on comrade
  if (touch) pose.hand[1] = { fr: handFrame(touch.p, touch.f, touch.b), curl: [0.3, 0.35, 0.2], thumb: 0.3, spread: 0.08 };
  // musket upright, butt on ground, in left hand
  const gp = G.p(-0.38 * s, 0, 0.3 * s);
  gp[1] = (ground ? ground(gp[0], gp[2]) : G.o[1]) + 0.04;
  pose.musket = musketFrame(gp, norm(G.d(-0.12, 1, 0.1)), G.d(-1, 0, 0));
  pose.hand[0] = { fr: gripOn(pose.musket, 0.78 * s, G.d(1, 0, 0.1), G.d(0, 0, -1), s, 0.016), curl: [1, 1.2, 0.7], thumb: 0.8 };
  pose.elbow = [norm(G.d(-1, -0.3, -0.5)), norm(G.d(1, -0.3, -0.5))];
  pose.expr = o.expr || { ...exprDefault(), brow: 0.7, eyes: 0.8, jaw: 0.1, wide: 0.2 };
  return pose;
}

// Officer striding ahead, turning back to his men, shouting, sword pointing forward
export function officerShout(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.9, 0], pitch: 0.05, roll: 0.04, yaw: -0.55 },
    spine: { bend: -0.05, twist: -0.75, side: -0.1 },
    head: { nod: -0.12, turn: -0.5, tilt: -0.08 },
    feet: [
      { p: [-0.12, 0.3], pitch: -0.1, yaw: -0.4 },
      { p: [0.15, -0.3], pitch: 0.45, yaw: -0.2 },
    ],
    knees: [[-0.2, 0, 1], [0.2, 0, 1]],
    hands: [
      // left arm beckoning back toward the men
      { p: [-0.42, 0.18, -0.15], f: [-0.6, 0.5, -0.4], b: [-0.3, 0.3, 1], curl: [0.25, 0.3, 0.15], spread: 0.12 },
      // sword arm raised forward toward the enemy (chest-local +x/-z because torso is twisted back)
      { p: [0.46, 0.38, 0.05], f: [0.6, 0.35, 0.4], b: [0, 1, -0.4], curl: [1.0, 1.2, 0.7], thumb: 0.8 },
    ],
    elbows: [[-1, -0.5, 0], [1, -0.6, -0.3]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.75, brow: -0.9, eyes: 0.9, wide: 0.6 };
  pose.musket = null;
  return pose;
}

// Officer / sergeant restoring alignment: arm extended along the line, shouting
export function officerAlign(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.91, 0], pitch: 0.02, roll: 0, yaw: o.yaw ?? 0.9 },
    spine: { bend: 0.08, twist: 0.35, side: 0.08 },
    head: { nod: 0.05, turn: o.headTurn ?? 0.4, tilt: 0.05 },
    feet: [
      { p: [-0.14, 0.18], pitch: 0, yaw: 0.2 },
      { p: [0.16, -0.12], pitch: 0.25, yaw: 0.5 },
    ],
    hands: [
      { p: [-0.62, 0.12, 0.22], f: [-1, 0.1, 0.35], b: [0, 1, 0], curl: [0.15, 0.2, 0.1], spread: 0.1 },
      { p: [0.26, -0.42, 0.12], f: [0.2, -0.6, 0.6], b: [1, 0, 0], curl: [1.0, 1.2, 0.7], thumb: 0.8 },
    ],
    elbows: [[-1, -0.2, -0.3], [1, -0.2, -0.6]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.65, brow: -0.8, eyes: 0.85, wide: 0.5 };
  pose.musket = null;
  return pose;
}

// Officer rallying his men: faces back toward them (G should face the men), sword arm raised high
// pointing toward the enemy behind him, other arm flung out beckoning, shouting.
export function officerRally(G, body, ground, o = {}) {
  const s = body.s;
  const pose = bodyPose(G, body, {
    pelvis: { p: [0, 0.9, 0], pitch: -0.04, roll: -0.05, yaw: 0.1 },
    spine: { bend: -0.12, twist: 0.25, side: -0.12 },
    head: { nod: -0.18, turn: -0.15, tilt: 0.1 },
    feet: [
      { p: [-0.13, 0.28], pitch: -0.05, yaw: -0.25 },
      { p: [0.17, -0.34], pitch: 0.35, yaw: 0.35 },
    ],
    knees: [[-0.2, 0, 1], [0.2, 0, 1]],
    hands: [
      // left arm flung out toward the men, open hand
      { p: [-0.5, 0.05, 0.3], f: [-0.7, 0.2, 0.7], b: [0, 1, 0.3], curl: [0.3, 0.4, 0.2], spread: 0.07 },
      // right (sword) arm raised high and back over the shoulder, toward the enemy
      { p: [0.32, 0.62, -0.12], f: [0.25, 0.9, -0.3], b: [1, -0.1, 0.2], curl: [1.0, 1.2, 0.7], thumb: 0.8 },
    ],
    elbows: [[-1, -0.6, 0], [1, -0.2, 0.2]],
  }, ground);
  pose.expr = { ...exprDefault(), jaw: 0.8, brow: -0.9, eyes: 0.95, wide: 0.55 };
  pose.musket = null;
  return pose;
}
