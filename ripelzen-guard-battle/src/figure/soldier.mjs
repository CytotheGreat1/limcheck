// Assemble a complete Ripelzen guardsman (body, uniform, head, bearskin, equipment, musket) from a pose.
import { solveSkeleton } from './skeleton.mjs';
import { buildTorso, buildSkirt, buildCollar, buildShoulderStraps, buildArms, buildLegs, buildNeck } from './body.mjs';
import { buildHead, buildBearskin, bearskinFrame } from './head.mjs';
import { buildMusket, buildEquipment, buildSword, buildGorget } from './equipment.mjs';
import { skinMat } from './materials.mjs';

export function buildSoldier(sol, lod) {
  const { body, face, pose } = sol;
  const att = sol.att;
  att.skinMat = skinMat(face.tone);
  if (pose.boxSwing) att.boxSwing = pose.boxSwing;
  if (pose.tailSwing) att.swing = pose.tailSwing;
  const sk = solveSkeleton(body, pose);
  sol.sk = sk;
  const meshes = [];
  meshes.push(buildTorso(sk, att, lod));
  meshes.push(...buildSkirt(sk, att, lod));
  meshes.push(buildCollar(sk, att, lod));
  if (att.officer) meshes.push(...buildShoulderStraps(sk, att, lod));
  meshes.push(...buildArms(sk, att, lod));
  meshes.push(...buildLegs(sk, att, lod));
  meshes.push(buildNeck(sk, att, lod));
  meshes.push(...buildHead(sk, face, pose.expr, lod, face.tone));
  meshes.push(...buildEquipment(sk, att, lod));
  if (pose.bearskin !== null) {
    const bfr = pose.bearskin || bearskinFrame(sk);
    meshes.push(...buildBearskin(bfr, body.s, lod, {
      officer: att.officer, wind: pose.plumeWind || [0, 0, 0], plumeTorn: pose.plumeTorn ?? null,
      cordsHang: pose.cordsHang || null, tasselSide: 1,
    }));
  }
  if (pose.musket) meshes.push(...buildMusket(pose.musket, lod, { sling: att.sling !== false, slingSag: pose.slingSag }));
  if (pose.sword) meshes.push(...buildSword(sk.hand[1].fr, pose.sword, body.s, lod));
  if (att.officer) meshes.push(buildGorget(sk, body.s));
  if (pose.extra) for (const fn of pose.extra) meshes.push(...fn(sk, lod));
  return meshes;
}
