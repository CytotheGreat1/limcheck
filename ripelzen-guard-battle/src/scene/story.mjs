// The scene's story: which guardsmen stand where, who is struck and how, who helps, where the officers are.
// Layout (see world/layout.mjs): the viewer stands ~1.8 m behind the rear rank at the flank of the line.
// s = metres along the line from the flank, a = metres ahead of the rear rank (toward the hidden enemy).
import { Frame, add, sub, mul, madd, norm, lerp, clamp, smoothstep, rotAxis, cross, vlerp } from '../core/math.mjs';
import { Rng, fbm2, noise2 } from '../core/rng.mjs';
import { buildSoldier } from '../figure/soldier.mjs';
import { buildMusket, musketFrame } from '../figure/equipment.mjs';
import { buildBearskin, buildPlume, randomFace, exprDefault } from '../figure/head.mjs';
import { makeBody } from '../figure/skeleton.mjs';
import { handFrame } from '../figure/skeleton.mjs';
import { buildLine, marcher, groundFrame, ground, applyMood, FILE_SP, RANK_SP, wobble } from './formation.mjs';
import {
  thrownBack, collapseSide, dropKnee, twistHatLoose, fallForward, clutchSide, recoil, sag, lying,
  riseOnMusket, crouchBeside, officerShout, officerAlign, officerRally, bodyPose, gripOn,
} from '../figure/actions.mjs';
import { L, A, fromLine } from '../world/layout.mjs';
import { height } from '../world/terrain.mjs';
import { superBox, limb } from '../figure/geom.mjs';
import { gridSurface } from '../core/mesh.mjs';
import { leatherMat, metalMat, C as COL } from '../figure/materials.mjs';
import { S as LS, resetS, shadeLit } from '../core/light.mjs';
const flatMat = (c) => ({ shade(F) { resetS(); LS.wrap = 0.3; LS.twoSided = true; F.tag = 9; shadeLit(F, c[0], c[1], c[2]); } });

const S0 = 5.2; // first file (flank) position along the line
export const fileS = (f, r = 0) => S0 + f * FILE_SP + r * 0.05;
export const rankA = (r) => r * RANK_SP;

function soldierItem(sol, extra = {}) {
  const g = sol.pose.G.o;
  const p = sol.pose.pelvis ? sol.pose.pelvis.o : [g[0], g[1] + 1, g[2]];
  return { kind: 'soldier', sol, pos: [p[0], p[1] + 0.2, p[2]], radius: 1.2, height: 2.4, build: (lod) => buildSoldier(sol, lod), ...extra };
}

// A special (non-marching) figure at (s, a) with a pose function
function special(seed, s, a, poseFn, o = {}) {
  const rng = new Rng(seed);
  const age = clamp(rng.gclip(0.45, 0.22), 0.05, 0.95);
  const body = makeBody(rng, o.body || {});
  const face = randomFace(rng, age);
  if (o.face) Object.assign(face, o.face);
  const G = groundFrame(s, a, o.yaw || 0);
  const pose = poseFn(G, body, ground, o);
  pose.plumeWind = pose.plumeWind || madd(mul(A, -0.05), L, 0.03);
  const att = { wear: rng.range(0.15, 0.5), sling: rng.chance(0.8), swing: pose.tailSwing, ...(o.att || {}) };
  if (o.expr) Object.assign(pose.expr, o.expr);
  if (o.mood) applyMood(pose.expr, o.mood, rng);
  return { body, face, pose, att, s, a, rng };
}

export function buildStory({ fast = false } = {}) {
  const items = [];
  const special_ = new Map();
  const key = (f, r) => f * 3 + r;
  const sols = [];

  // ---------------- the canister strike (flank files 0-3) ----------------
  const cas = [];
  // rear rank (nearest the viewer): thrown backward, dropping to one knee
  cas.push(['thrown', 1, 0, (G, b, g) => thrownBack(G, b, g)]);
  cas.push(['knee', 2, 0, (G, b, g) => dropKnee(G, b, g)]);
  // middle rank: pitching face-forward at the flank, twisting as his bearskin flies, collapsing sideways
  cas.push(['forward', 0, 1, (G, b, g) => fallForward(G, b, g)]);
  cas.push(['twist', 1, 1, (G, b, g) => twistHatLoose(G, b, g)]);
  cas.push(['collapse', 2, 1, (G, b, g) => collapseSide(G, b, g, 1)]);
  // front rank: the flank man clutches his side and stays on his feet; another is already down
  cas.push(['clutch', 0, 2, (G, b, g) => clutchSide(G, b, g)]);
  cas.push(['down', 1, 2, (G, b, g) => lying(G.yaw(2.4), b, g, { supine: true, curl: 0.4, armsOut: 0.8 })]);
  for (const [name, f, r, fn] of cas) {
    const sol = special(900 + f * 3 + r, fileS(f, r) + (name === 'down' ? 0.1 : 0), rankA(r) + (name === 'down' ? 0.3 : 0) + (name === 'thrown' ? -0.15 : 0), fn);
    sol.name = name; sol.file = f; sol.rank = r;
    special_.set(key(f, r), sol);
    sols.push(sol);
  }
  const byName = (n) => sols.find((x) => x.name === n);
  // the twisting man's bearskin flies off, tumbling up and back
  {
    const tw = byName('twist');
    tw.pose.bearskin = null;
    tw.face.hair = [0.035, 0.024, 0.017];
    const G = tw.pose.G;
    const c = madd(madd(madd(G.o, [0, 1, 0], 2.15), G.z, -0.75), L, -0.35);
    const fr = Frame.fromUpFwd(c, norm(G.d(0.9, 0.45, -0.6)), G.x);
    items.push({ kind: 'prop', pos: c, radius: 0.5, height: 0.6, build: (lod) => buildBearskin(fr, tw.body.s, lod, { wind: G.d(0, -0.03, -0.1) }) });
  }
  // the man falling forward: his musket spins through the air ahead of him
  {
    const ff = byName('forward');
    const G = ff.pose.G;
    const c = madd(madd(G.o, [0, 1, 0], 1.5), G.z, 0.55);
    const dir = norm(G.d(-0.5, 0.45, 0.75));
    const fr = musketFrame(madd(c, dir, -0.75), dir, rotAxis(G.y, dir, 1.2));
    items.push({ kind: 'prop', pos: c, radius: 0.9, height: 1, build: (lod) => buildMusket(fr, lod, { sling: true, slingSag: G.d(0, 0.3, -1) }) });
  }
  // the thrown man's plume, torn free and whirling above
  {
    const tb = byName('thrown');
    const G = tb.pose.G;
    const c = madd(madd(madd(G.o, [0, 1, 0], 2.4), G.z, -0.45), G.x, 0.2);
    const fr = Frame.fromUpFwd(c, norm(G.d(-0.7, 0.5, -0.4)), G.z);
    items.push({ kind: 'prop', pos: c, radius: 0.4, height: 0.5, build: (lod) => buildPlume(fr, tb.body.s, lod, G.d(0, -0.02, -0.08), fr) });
  }
  // a cartridge box snapped from its strap, flying
  {
    const cl = byName('collapse');
    const G = cl.pose.G;
    const c = madd(madd(G.o, [0, 1, 0], 1.2), G.z, -0.55);
    const fr = Frame.fromUpFwd(c, norm(G.d(0.4, 1, 0.5)), G.x);
    items.push({
      kind: 'prop', pos: c, radius: 0.3, height: 0.3, build: (lod) => {
        const b = superBox(fr, 0.04, 0.075, 0.11, 6, { nu: 14, nv: 8 });
        b.material = leatherMat(COL.blackLeather, { spec: 0.9, shin: 30 });
        return [b];
      },
    });
  }

  // ---------------- neighbours reacting ----------------
  const mods = new Map();
  // file 0 rear rank (nearest): musket vertical at the shoulder, looking toward the hidden guns
  mods.set(key(0, 0), { mood: 'set', turn: -0.25, nod: -0.14, carry: 'shoulder', lean: 0.06, armSwing: 0.9, phase: 0.62 });
  // file 3 rear rank: reaches for the kneeling man without leaving the line
  mods.set(key(3, 0), { mood: 'shock', turn: -0.75, nod: 0.12, carry: 'trail', reach: { who: 'knee', hand: 0 }, ds: -0.1 });
  // file 3 middle rank: steadies the collapsing man
  mods.set(key(3, 1), { mood: 'shock', carry: 'trail', turn: -0.6, lean: 0.03, reach: { who: 'collapse', hand: 0 }, ds: -0.1 });
  // file 2 front rank: ducks as shot passes, turning toward the captain's order
  mods.set(key(2, 2), { mood: 'fear', turn: -0.5, nod: 0.3, carry: 'port', crouch: 0.05, lean: 0.14 });
  mods.set(key(3, 2), { mood: 'tense', turn: -0.7, carry: 'port' });
  // files 4-6 close toward the gap, stepping around the fallen, muskets raised
  mods.set(key(4, 2), { mood: 'grim', carry: 'port', carryOpt: { dy: 0.05, tiltY: 0.08, lpos: -0.1 }, ds: -0.25, footX: [0.08, 0.12], turn: -0.3 });
  mods.set(key(4, 1), { mood: 'tense', carry: 'port', carryOpt: { dy: 0.07, tiltY: 0.12, lpos: -0.1 }, ds: -0.2, turn: -0.55, lean: 0.12 });
  mods.set(key(4, 0), { mood: 'grim', ds: -0.15, turn: -0.45, carry: 'port', carryOpt: { dy: 0.06, tiltY: 0.1, lpos: -0.1 } });
  mods.set(key(5, 2), { mood: 'angry', ds: -0.2, carry: 'port', turn: -0.25 });
  mods.set(key(5, 1), { mood: 'shout', turn: -0.6, carry: 'port' });
  mods.set(key(5, 0), { mood: 'set', turn: -0.3 });
  mods.set(key(6, 0), { mood: 'tired', turn: -0.55, nod: 0.1 });
  // head lowered as shot passes overhead
  for (const [f, r] of [[7, 1], [10, 2], [13, 0], [18, 1], [22, 2]]) mods.set(key(f, r), { mood: 'fear', nod: 0.4, crouch: 0.06, lean: 0.16, turn: 0.1 });
  // glances toward the wounded
  for (const [f, r] of [[8, 0], [12, 1], [16, 0], [9, 1], [20, 0]]) mods.set(key(f, r), { mood: 'tense', turn: -0.75 });
  const ball = [];
  ball.push(['recoil', 12, 1, (G, b, g) => recoil(G, b, g)]);
  ball.push(['sag', 9, 2, (G, b, g) => sag(G, b, g)]);
  ball.push(['clutch2', 18, 2, (G, b, g) => clutchSide(G, b, g)]);
  ball.push(['knee2', 27, 1, (G, b, g) => dropKnee(G, b, g)]);
  for (const [name, f, r, fn] of ball) {
    const sol = special(700 + f * 3 + r, fileS(f, r), rankA(r), fn);
    sol.name = name; sol.file = f; sol.rank = r;
    special_.set(key(f, r), sol);
    sols.push(sol);
  }
  // file 10 front rank reaches toward the sagging man without leaving the line
  mods.set(key(10, 2), { mood: 'shock', turn: -0.5, reach: { who: 'sag', hand: 0 }, carry: 'trail' });
  mods.set(key(12, 0), { mood: 'fear', turn: 0.5 });

  // ---------------- the line itself ----------------
  const line = buildLine(11, {
    files: fast ? 140 : 330,
    sStart: S0,
    skip: (f, r) => special_.has(key(f, r)),
    mod: (f, r) => mods.get(key(f, r)) || null,
  });
  for (const sol of line) sols.push(sol);

  // reaching hands
  for (const sol of line) {
    const m = mods.get(key(sol.file, sol.rank));
    if (!m || !m.reach) continue;
    const who = byName(m.reach.who);
    if (!who) continue;
    const i = m.reach.hand;
    // target: the other man's shoulder/upper arm (approximate from his pelvis)
    // target: the other man's upper arm, kept at a natural reach from the helper's own chest
    let tp = madd(who.pose.pelvis.o, who.pose.pelvis.y, 0.3 * who.body.s);
    const chestP = madd(sol.pose.pelvis.o, [0, 1, 0], 0.35);
    let d = sub(tp, chestP);
    const dl = Math.hypot(d[0], d[1], d[2]);
    d = norm(d);
    const reachL = Math.min(Math.max(dl, 0.42), 0.55);
    const tgt = madd(chestP, d, reachL);
    sol.pose.hand[i] = { fr: handFrame(tgt, norm(add(d, [0, -0.3, 0])), [0, 1, 0]), curl: [0.5, 0.7, 0.4], thumb: 0.6, spread: 0.1 };
    if (i === 0 && sol.carry === 'shoulder') sol.pose.musket = null;
  }

  // ---------------- officers & file closers ----------------
  const off = (seed, s, a, fn, o = {}) => {
    const sol = special(seed, s, a, fn, { ...o, att: { officer: true, sling: false, ...(o.att || {}) } });
    return sol;
  };
  // the captain: ahead of the flank, turned back to face his men and the viewer, sword raised toward the enemy
  const capt = off(501, 6.0, 3.0, (G, b, g) => officerRally(G.yaw(Math.PI + 0.55), b, g), { face: { moustache: 1.1, age: 0.6, stubble: 0.4, ruddy: 0.8 } });
  capt.pose.sword = norm([A[0] * 0.55, 0.8, A[2] * 0.55 - 0.15]);
  capt.name = 'captain';
  sols.push(capt);
  const lieut = off(502, 13.2, -1.2, (G, b, g) => officerAlign(G, b, g, { yaw: -1.3, headTurn: 0.3 }), { face: { moustache: 0.7, age: 0.3 } });
  lieut.pose.sword = norm(add(mul(L, 0.2), [0, -1, 0]).map((v, i) => v + A[i] * 0.4));
  lieut.name = 'lieutenant';
  sols.push(lieut);
  // sergeant (file closer) marching behind the line, shouting to close up
  {
    const rng = new Rng(503);
    const sol = marcher(rng, 12.2, -1.3, { mood: 'shout', carry: 'port', turn: 0.9, nod: -0.05 });
    sol.name = 'sergeant';
    sols.push(sol);
    const rng2 = new Rng(504);
    const sol2 = marcher(rng2, 21.5, -1.4, { mood: 'set', carry: 'port', turn: 0.3 });
    sols.push(sol2);
  }

  // ---------------- behind the line: the fallen and the wounded ----------------
  // foreground: a guardsman crouches beside a fallen comrade
  const fallen = special(601, 5.6, -1.55, (G, b, g) => lying(G.yaw(-2.2), b, g, { supine: true, curl: 0.25, armsOut: 0.9, legBend: 0.4 }), { mood: 'dead' });
  fallen.face.pale = 0.6;
  fallen.pose.bearskin = null;
  sols.push(fallen);
  {
    const fp = fallen.pose;
    const tgt = madd(fp.pelvis.o, fp.pelvis.y, 0.38 * fallen.body.s);
    tgt[1] += 0.12;
    const crouch = special(602, 4.65, -1.75, (G, b, g) => crouchBeside(G.yaw(0.9), b, g, {
      p: tgt, f: norm(add(L, [0, -0.5, 0])), b: [0, 1, 0.2],
    }, { twist: 0.25, turn: -0.2, nod: 0.3 }), { mood: 'grim' });
    crouch.name = 'crouch';
    sols.push(crouch);
    // the fallen man's bearskin on the grass beside him
    const bpos = madd(madd(fp.pelvis.o, fp.pelvis.y, 0.95), L, 0.25);
    bpos[1] = height(bpos[0], bpos[2]) + 0.1;
    const bfr = Frame.fromUpFwd(bpos, norm(add(L, [0, 0.35, 0])), [0, 1, 0]);
    items.push({ kind: 'prop', pos: bpos, radius: 0.5, height: 0.5, build: (lod) => buildBearskin(bfr, 1, lod, { wind: [0, -0.05, 0] }) });
  }
  const riser = special(603, 11.5, -1.55, (G, b, g) => riseOnMusket(G.yaw(0.5), b, g), { mood: 'pain' });
  riser.name = 'riser';
  sols.push(riser);
  const bodies = [[8.2, -1.25, 1.2, true], [15.5, -1.9, 2.9, false], [25, -1.5, 0.4, false], [33, -2.3, -2.2, true], [44, -1.7, 1.6, false]];
  bodies.forEach(([s, a, yaw, sup], i) => {
    const b = special(610 + i, s, a, (G, bd, g) => lying(G.yaw(yaw), bd, g, { supine: sup, curl: 0.3 + i * 0.1, armsOut: 0.3 + (i % 3) * 0.3 }), { mood: 'dead' });
    b.face.pale = 0.5;
    if (i % 2) b.pose.bearskin = null;
    sols.push(b);
  });
  // dropped muskets on the grass
  for (const [s, a, yaw] of [[6.9, -0.7, 0.4], [8.9, -1.9, 2.0], [16.2, -1.2, -0.8], [6.4, 2.3, 1.3]]) {
    const [x, z] = fromLine(s, a);
    const y = height(x, z) + 0.035;
    const dir = norm(rotAxis(L, [0, 1, 0], yaw));
    const fr = musketFrame([x, y, z], dir, rotAxis([0, 1, 0], dir, 1.4));
    items.push({ kind: 'prop', pos: [x, y, z], radius: 0.9, height: 0.2, build: (lod) => buildMusket(fr, lod, { sling: false }) });
  }

  // ---------------- stretcher bearers carrying a wounded man to the rear, half lost in smoke ----------------
  {
    const s0 = 50, a0 = -4.2;
    const back = mul(A, -1);
    const yawBack = Math.PI; // relative to the line's facing
    const bearers = [];
    for (let k = 0; k < 2; k++) {
      const rng = new Rng(620 + k);
      const sol = marcher(rng, s0, a0 - k * 2.3, { carry: 'shoulder', mood: 'tired', yaw: yawBack + 0.08, lean: 0.12, armSwing: 0 });
      sol.pose.musket = null;
      bearers.push(sol);
    }
    // stretcher poles between the bearers' hands at hip height
    const [b0, b1] = bearers;
    const c0 = b0.pose.pelvis, c1 = b1.pose.pelvis;
    const poleY = (c0.o[1] + c1.o[1]) / 2 - 0.2;
    const side = norm([L[0], 0, L[2]]);
    const ends = [];
    for (const sg of [-1, 1]) {
      const p0 = madd([c0.o[0], poleY, c0.o[2]], side, sg * 0.28);
      const p1 = madd([c1.o[0], poleY, c1.o[2]], side, sg * 0.28);
      ends.push([madd(p0, back, 0.35), madd(p1, back, -0.35)]);
    }
    for (const [bi, sol] of bearers.entries()) {
      for (let i = 0; i < 2; i++) {
        const sg = i === 0 ? -1 : 1;
        const e = ends[i === 0 ? 0 : 1][bi === 0 ? 0 : 1];
        const gp = madd(e, back, bi === 0 ? -0.15 : 0.15);
        sol.pose.hand[i] = { fr: handFrame(gp, [0, -1, 0], mul(side, sg)), curl: [1, 1.2, 0.7], thumb: 0.8 };
      }
      sols.push(sol);
    }
    items.push({
      kind: 'prop', pos: vlerp(c0.o, c1.o, 0.5), radius: 2, height: 1, build: () => {
        const out = [];
        for (const [a, b] of ends) {
          const pole = limb(a, b, [0, 1, 0], () => [0.02, 0.02], { nu: 6, nv: 2 });
          pole.material = flatMat([0.2, 0.15, 0.1]);
          out.push(pole);
        }
        const cv = gridSurface(2, 6, (u, v) => {
          const p = vlerp(vlerp(ends[0][0], ends[0][1], 0.15 + v * 0.7), vlerp(ends[1][0], ends[1][1], 0.15 + v * 0.7), u);
          return [p[0], p[1] - 0.06 * Math.sin(Math.PI * u), p[2]];
        });
        cv.material = flatMat([0.45, 0.42, 0.36]);
        out.push(cv);
        return out;
      },
    });
    // the wounded man on the stretcher
    const mid = vlerp(c0.o, c1.o, 0.5);
    const [ms, ma] = [s0, a0 - 1.15];
    const wounded = special(630, ms, ma, (G, bd) => lying(G.yaw(-Math.PI / 2 + 0.05), bd, () => poleY - 0.1, { supine: true, curl: 0.15, armsOut: 0.2 }), { mood: 'pain' });
    wounded.pose.bearskin = null;
    sols.push(wounded);
  }

  // ---------------- the second battalion, far behind in the haze ----------------
  if (!fast) {
    for (let f = 0; f < 150; f++) {
      for (let r = 0; r < 3; r++) {
        const rng = new Rng(8000 + f * 3 + r);
        const s = 36 + f * FILE_SP + rng.gclip(0, 0.08);
        const a = -48 + r * RANK_SP + 1.5 * Math.sin(s * 0.03);
        const sol = marcher(rng, s, a, {});
        sols.push(sol);
      }
    }
  }

  // the figures the painter finishes most carefully; the rest of the line is handled more broadly
  const FOCAL = new Set(['thrown', 'knee', 'forward', 'twist', 'collapse', 'clutch', 'captain', 'crouch', 'riser', 'fallen']);
  fallen.name = 'fallen';
  for (const sol of sols) {
    const focal = FOCAL.has(sol.name) || (sol.file === 0 && sol.rank === 0) || (sol.file === 3 && sol.rank <= 1);
    items.push(soldierItem(sol, { focal }));
  }

  // ---------------- light: patches of sun through smoke ----------------
  const focus = [fromLine(5.8, 1.0), fromLine(6.3, 3.1)];
  const sunMask = (x, z) => {
    let n = fbm2(x * 0.018 + 4.2, z * 0.018 - 1.1, 4) + 0.35 * fbm2(x * 0.004, z * 0.004 + 3, 3);
    for (const [fx, fz] of focus) n += 0.55 * Math.exp(-((x - fx) ** 2 + (z - fz) ** 2) / 14);
    // the near right foreground in the shadow of a passing smoke cloud
    n -= 0.9 * Math.exp(-((x - 2.1) ** 2 + (z - 4.2) ** 2) / 5);
    return lerp(0.1, 1, smoothstep(-0.05, 0.3, n));
  };
  return { items, sunMask, aoFn: null, groundAO: null, sols };
}
