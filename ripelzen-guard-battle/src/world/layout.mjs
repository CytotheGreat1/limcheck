// World layout: camera placement, formation axes and key story locations (metres, world space).
import { norm } from '../core/math.mjs';

export const EYE = 1.5; // viewer at shoulder height
export const PHI = 14 * Math.PI / 180; // angle between view axis and the battle line
// Line direction (recedes into the distance, drifting right) and advance direction (left, slightly away)
export const L = [Math.sin(PHI), 0, Math.cos(PHI)];
export const A = [-Math.cos(PHI), 0, Math.sin(PHI)];
export const LINE_OFFSET = 0.9 / Math.cos(14 * Math.PI / 180); // rear rank passes this far to the viewer's left (along -x at z=0)

export const alongLine = (x, z) => x * L[0] + z * L[2];
export const aheadOf = (x, z) => x * A[0] + z * A[2] - LINE_OFFSET * Math.cos(PHI) * 0; // raw projection
// signed distance ahead of the rear-rank line (positive = toward the enemy)
export function aheadRear(x, z) {
  // rear line passes through (-LINE_OFFSET, 0) at z = 0 with direction L
  const px = x + LINE_OFFSET, pz = z;
  return px * A[0] + pz * A[2];
}
export function lineCoords(x, z) {
  const px = x + LINE_OFFSET, pz = z;
  return [px * L[0] + pz * L[2], px * A[0] + pz * A[2]];
}
export function fromLine(s, a) {
  return [-LINE_OFFSET + L[0] * s + A[0] * a, L[2] * s + A[2] * a];
}

// inverse of fromLine: world (x,z) -> (s,a)
export function toLine(x, z) {
  const px = x + LINE_OFFSET;
  return [px * L[0] + z * L[2], px * A[0] + z * A[2]];
}
// approximate 4K screen position of a ground point (debug aid)
export function screenOf(s, a, y = 1.1) {
  const [x, z] = fromLine(s, a);
  const f = 3688;
  return [Math.round(1920 + (f * x) / z), Math.round(1015 - (f * (y - EYE)) / z), +z.toFixed(2)];
}
