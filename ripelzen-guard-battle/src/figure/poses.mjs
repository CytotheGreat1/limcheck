// Pose archetypes. All take a ground frame G (origin on the ground below the body centre, z = facing).
import { Frame, add, sub, mul, madd, norm, cross, dot, len, perp, rotAxis, vlerp, lerp, smoothstep, clamp } from '../core/math.mjs';
import { REF, gripFrame, handFrame } from './skeleton.mjs';
import { musketFrame, musketAxis, MUSKET_LEN } from './equipment.mjs';
import { exprDefault } from './head.mjs';

const HEEL = [0, -0.078, -0.055], BALL = [0, -0.078, 0.14], TOE = [0, -0.07, 0.2];

// Place a foot: ankle frame whose lowest contact point touches ground height gy at horizontal pos (x,z).
export function placeFoot(G, s, lx, lz, pitch, yaw, gy, lift = 0) {
  let fr = G.yaw(yaw).pitch(pitch);
  let minY = 0;
  for (const p of [HEEL, BALL, TOE]) {
    const d = fr.d(p[0] * s, p[1] * s, p[2] * s);
    minY = Math.min(minY, d[1]);
  }
  const base = G.p(lx, 0, lz);
  const ank = [base[0], gy - minY + lift, base[2]];
  return fr.at(ank);
}

function footAngles(t, duty) {
  // pitch (+ = heel up) and lift through the gait cycle
  if (t < duty) {
    if (t < 0.1) return [lerp(-0.26, 0, smoothstep(0, 0.1, t)), 0];
    if (t < duty - 0.2) return [0, 0];
    return [lerp(0, 0.62, smoothstep(duty - 0.2, duty, t)), 0];
  }
  const k = (t - duty) / (1 - duty);
  const pitch = lerp(0.62, -0.26, smoothstep(0, 1, k)) + 0.25 * Math.sin(Math.PI * k);
  const lift = 0.075 * Math.sin(Math.PI * Math.min(1, k * 1.15));
  return [pitch, lift];
}

// ground(x,z) -> height
export function marchBase(G, body, o = {}, ground) {
  const s = body.s;
  const phase = o.phase ?? 0;
  const stride = (o.stride ?? 1.2) * s;
  const duty = 0.6;
  const width = (o.stance ?? 0.1) * s;
  const pose = { expr: exprDefault() };
  const feet = [];
  let zs = [];
  for (let i = 0; i < 2; i++) {
    const t = (phase + (i === 0 ? 0 : 0.5)) % 1;
    let z;
    const front = 0.3 * stride / 1.2, back = -0.42 * stride / 1.2;
    if (t < duty) z = lerp(front, back, t / duty);
    else z = lerp(back, front, smoothstep(0, 1, (t - duty) / (1 - duty)));
    let [pitch, lift] = footAngles(t, duty);
    if (o.shuffle) { lift *= 0.4; pitch *= 0.5; }
    const side = i === 0 ? -1 : 1;
    const lx = side * width + (o.footX ? o.footX[i] : 0);
    z += o.footZ ? o.footZ[i] : 0;
    const wp = G.p(lx, 0, z);
    const gy = ground ? ground(wp[0], wp[2]) : G.o[1];
    const yaw = side * (o.toeOut ?? 0.12) + (o.footYaw ? o.footYaw[i] : 0);
    feet.push(placeFoot(G, s, lx, z, pitch + (o.footPitch ? o.footPitch[i] : 0), yaw, gy - 0.012 * s, lift * s));
    zs.push(z);
  }
  pose.ankle = feet.map((f) => f.o);
  pose.foot = feet;
  pose.knee = [G.z, G.z].map((k, i) => norm(add(k, mul(G.x, (i === 0 ? -1 : 1) * 0.15))));
  // pelvis
  const bob = 0.016 * s * Math.cos(Math.PI * 4 * (phase - 0.3));
  const lean = o.lean ?? 0.06;
  const yaw = 0.09 * (zs[0] - zs[1]) / stride * 2 + (o.twist ?? 0) * 0.3;
  const roll = 0.03 * Math.sin(Math.PI * 2 * phase);
  const shift = 0.018 * s * Math.sin(Math.PI * 2 * (phase + 0.05));
  let py = (o.crouch ? REF.pelvisY - o.crouch : REF.pelvisY - 0.03) * s + bob;
  const gAvg = ((feet[0].o[1] - 0.08 * s) + (feet[1].o[1] - 0.08 * s)) / 2;
  let pelvisO = G.p(shift + (o.pelvisX ?? 0), 0, (o.pelvisZ ?? 0.02) * s);
  pelvisO[1] = gAvg + py;
  // ensure reach
  const Lmax = (REF.thigh + REF.shin) * s * 0.985;
  let P = G.yaw(yaw).roll(roll).pitch(lean * 0.35);
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < 2; i++) {
      const hip = madd(pelvisO, P.x, (i === 0 ? -1 : 1) * REF.hipX * s);
      const d = sub(pose.ankle[i], hip);
      const dh = Math.hypot(d[0], d[2]);
      if (dh < Lmax) {
        const need = pose.ankle[i][1] + Math.sqrt(Lmax * Lmax - dh * dh);
        if (hip[1] > need) pelvisO[1] -= hip[1] - need;
      }
    }
  }
  pose.pelvis = P.at(pelvisO);
  pose.spine = { bend: lean * 0.65 + (o.bend ?? 0), twist: -yaw * 0.7 + (o.twist ?? 0), side: -roll * 0.5 + (o.side ?? 0) };
  pose.head = { nod: o.nod ?? -lean * 0.6, turn: o.turn ?? 0, tilt: o.tilt ?? 0 };
  pose.phase = phase;
  pose.armSwing = Math.sin(Math.PI * 2 * phase) * (o.armSwing ?? 1); // + => right arm forward
  pose.G = G;
  pose.stride = stride;
  return pose;
}

// Chest frame approximation before solving (for placing muskets/hands relative to the upper body)
export function chestOf(pose, body) {
  const s = body.s;
  const P = pose.pelvis;
  const sp = pose.spine;
  const lum = P.yaw(sp.twist * 0.35).pitch(sp.bend * 0.4).roll(sp.side * 0.4);
  const lumO = P.p(0, 0.1 * s, 0);
  let chest = lum.yaw(sp.twist * 0.65).pitch(sp.bend * 0.6).roll(sp.side * 0.6);
  return chest.at(madd(madd(lumO, lum.y, 0.12 * s), chest.y, 0.14 * s));
}

// ---------------- arm helpers ----------------
export function relaxedHand(C, s, side, swing, o = {}) {
  // wrist hanging by the thigh; swing forward/back
  const x = side * (0.2 + (o.out ?? 0)) * s, y = (-0.43 + (o.up ?? 0) + Math.abs(swing) * 0.03) * s, z = (0.02 + swing * 0.13 + (o.fwd ?? 0)) * s;
  const o0 = C.p(x, y, z);
  const fingers = norm(C.d(side * 0.05, -1, swing * 0.35 + 0.1));
  const back = C.d(side, 0, -0.2);
  return { fr: handFrame(o0, fingers, back), curl: o.curl || [0.35, 0.55, 0.3], thumb: 0.3, spread: 0.04 };
}

// Musket carries return {musket: Frame, hands: [left,right] (null = free)}
export function carryShoulder(C, s, o = {}) {
  const D = norm(C.d(-0.05 + (o.tiltX ?? 0), 1, -0.15 + (o.tiltZ ?? 0)));
  const butt = C.p((-0.24 + (o.dx ?? 0)) * s, (-0.46 + (o.dy ?? 0)) * s, (0.1 + (o.dz ?? 0)) * s);
  const fr = musketFrame(butt, D, C.z);
  // left hand along the outside of the butt, fingers down/under
  const G = fr.p(0, -0.085, 0.07);
  const hand = gripFrame(G, fr.y, C.x, mul(C.y, -1), s, 0.022);
  return { musket: fr, hands: [{ fr: hand, curl: [0.9, 1.1, 0.6], thumb: 0.2, spread: 0.02 }, null] };
}

export function carryPort(C, s, o = {}) {
  // diagonal across the body; right hand at the wrist of the stock, left hand on the fore-stock
  const D = norm(C.d(-0.5 + (o.tiltX ?? 0), 0.82 + (o.tiltY ?? 0), 0.25 + (o.tiltZ ?? 0)));
  const rh = C.p((0.1 + (o.dx ?? 0)) * s, (-0.3 + (o.dy ?? 0)) * s, (0.22 + (o.dz ?? 0)) * s);
  const butt = madd(rh, D, -0.33);
  const up = norm(perp(C.z, D));
  const fr = musketFrame(butt, D, up);
  const gR = musketAxis(fr, 0.33);
  const gL = musketAxis(fr, 0.7 + (o.lpos ?? 0));
  const hr = gripFrame(gR, D, mul(fr.y, 1), C.d(-1, 0, 0.3), s, 0.02);
  const hl = gripFrame(gL, D, mul(fr.y, -1), C.d(1, -0.2, -0.2), s, 0.018);
  return { musket: fr, hands: [{ fr: hl, curl: [0.95, 1.2, 0.7], thumb: 0.8 }, { fr: hr, curl: [1.0, 1.25, 0.7], thumb: 0.8 }] };
}

export function carryTrail(C, s, o = {}) {
  // in the right hand, arm low, musket nearly horizontal pointing forward
  const D = norm(C.d(0.02, 0.18 + (o.tiltY ?? 0), 1));
  const g = C.p(0.23 * s, -0.5 * s, (0.06 + (o.fwd ?? 0)) * s);
  const butt = madd(g, D, -0.62);
  const fr = musketFrame(butt, D, C.y);
  const hr = gripFrame(musketAxis(fr, 0.62), D, mul(C.y, -1), C.d(0.3, -1, 0), s, 0.018);
  return { musket: fr, hands: [null, { fr: hr, curl: [1.0, 1.2, 0.7], thumb: 0.8 }] };
}

export function carryReady(C, s, o = {}) {
  // leveled forward at waist height (tightly gripped, bracing)
  const D = norm(C.d(-0.12 + (o.tiltX ?? 0), 0.5 + (o.tiltY ?? 0), 1));
  const rh = C.p(0.14 * s, -0.36 * s, 0.1 * s);
  const butt = madd(rh, D, -0.33);
  const fr = musketFrame(butt, D, C.y);
  const hr = gripFrame(musketAxis(fr, 0.33), D, mul(fr.y, 1), C.d(-1, -0.4, 0), s, 0.02);
  const hl = gripFrame(musketAxis(fr, 0.8 + (o.lpos ?? 0)), D, mul(fr.y, 1), C.d(1, -0.4, 0), s, 0.018);
  return { musket: fr, hands: [{ fr: hl, curl: [1.0, 1.2, 0.7], thumb: 0.8 }, { fr: hr, curl: [1.0, 1.25, 0.7], thumb: 0.8 }] };
}

// Apply a carry to a pose; free hands get relaxed swing.
export function applyCarry(pose, body, carry, o = {}) {
  const s = body.s;
  const C = chestOf(pose, body);
  const r = carry(C, s, o.carry || {});
  pose.musket = r.musket;
  pose.hand = [0, 1].map((i) => r.hands[i] || relaxedHand(C, s, i === 0 ? -1 : 1, (i === 0 ? -1 : 1) * pose.armSwing * 0.8, o.relaxed?.[i] || {}));
  pose.elbow = [0, 1].map((i) => norm(add(C.d((i === 0 ? -1 : 1) * 0.7, -0.3, -1), [0, 0, 0])));
  return pose;
}

export function standPose(G, body, ground) {
  const pose = marchBase(G, body, { phase: 0.3, stride: 0.0001, lean: 0, stance: 0.11, toeOut: 0.25 }, ground);
  const s = body.s;
  const C = chestOf(pose, body);
  // musket grounded at the left side, held with left hand at chest height
  const butt = G.p(-0.3 * s, 0.005, 0.12 * s);
  butt[1] = pose.foot[0].o[1] - 0.075 * s;
  const D = norm(G.d(0.02, 1, -0.02));
  const fr = musketFrame(butt, D, mul(G.z, 1));
  const hl = gripFrame(musketAxis(fr, 1.02 * s), D, G.x, mul(G.x, -0.2).map((v, i) => v + G.z[i] * 0.2 + G.y[i] * 0.9), s, 0.016);
  pose.musket = fr;
  pose.hand = [{ fr: hl, curl: [1.0, 1.2, 0.7], thumb: 0.8 }, relaxedHand(C, s, 1, 0, { curl: [0.5, 0.8, 0.5] })];
  pose.elbow = [norm(C.d(-1, -0.2, -0.3)), norm(C.d(1, 0, -1))];
  pose.armSwing = 0;
  return pose;
}
