// Parametric primitives used to sculpt figures and props.
import { gridSurface } from '../core/mesh.mjs';
import { norm, cross, sub, dot, madd, len, perp, Frame } from '../core/math.mjs';

// signed power, for superellipse cross sections
export const spow = (x, p) => (x < 0 ? -Math.pow(-x, p) : Math.pow(x, p));

// Tube along a spine given by a function spine(t) -> {c:[x,y,z], a:[..], b:[..]} (a,b section axes),
// section radii rad(t, theta) -> [ra, rb] (theta 0..2PI, a-axis at theta=0), superellipse exponent ex.
export function sweep(nu, nv, spine, rad, { ex = 2, capA = true, capB = true, exFn = null, flip = false } = {}) {
  const q = 2 / ex;
  return gridSurface(nu, nv, (u, v) => {
    const th = u * Math.PI * 2;
    const s = spine(v);
    const r = rad(v, th);
    const ca = spow(Math.cos(th), q), sa = spow(Math.sin(th), q);
    let ra = r[0], rb = r[1];
    return [
      s.c[0] + s.a[0] * ra * ca + s.b[0] * rb * sa,
      s.c[1] + s.a[1] * ra * ca + s.b[1] * rb * sa,
      s.c[2] + s.a[2] * ra * ca + s.b[2] * rb * sa,
    ];
  }, { wrapU: true, exFn, flip });
}

// Cap profile: maps v in [0,1] to (t along the body in [0,1], radius factor), with hemispherical ends
// occupying fraction ca / cb of the parameter range.
export function capProfile(v, ca, cb) {
  if (v < ca) {
    const k = v / ca; // 0 -> 1
    return [0, Math.sqrt(Math.max(0, 1 - (1 - k) * (1 - k))), -(1 - k)];
  }
  if (v > 1 - cb) {
    const k = (1 - v) / cb;
    return [1, Math.sqrt(Math.max(0, 1 - (1 - k) * (1 - k))), 1 - k];
  }
  return [(v - ca) / (1 - ca - cb), 1, 0];
}

// Limb segment from A to B. radius(t) -> [rx, rz] across (ref gives the orientation of rx).
// Hemispherical caps of size capA/capB (metres) make joints blend when overlapping spheres.
export function limb(A, B, ref, radius, { nu = 16, nv = 12, capA = 0, capB = 0, ex = 2, exFn = null, bend = null, disp = null } = {}) {
  const ax = sub(B, A);
  const L = len(ax);
  const t = norm(ax);
  let a = perp(ref, t);
  if (len(a) < 1e-6) a = perp([1, 0, 0], t);
  a = norm(a);
  const b = cross(t, a);
  const tot = L + capA + capB;
  const ca = capA / tot, cb = capB / tot;
  return sweep(nu, nv, (v) => {
    const [tt, , over] = capProfile(v, ca, cb);
    let d = tt * L;
    if (over < 0) d = over * capA;
    else if (over > 0) d = L + over * capB;
    let c = madd(A, t, d);
    if (bend) c = madd(c, bend.dir, bend.amt * Math.sin(Math.PI * Math.min(1, Math.max(0, d / L))));
    return { c, a, b };
  }, (v, th) => {
    const [tt, k] = capProfile(v, ca, cb);
    const r = radius(tt);
    const dd = disp ? 1 + disp(tt, th) : 1;
    return [r[0] * k * dd, r[1] * k * dd];
  }, { ex, exFn });
}

// Ellipsoid in a frame with radii rx, ry, rz. deform(p_local, u, v) optional returns displaced local point.
export function ellipsoid(fr, rx, ry, rz, { nu = 24, nv = 16, deform = null, exFn = null } = {}) {
  return gridSurface(nu, nv, (u, v) => {
    const th = u * Math.PI * 2, ph = v * Math.PI;
    const sp = Math.sin(ph);
    let p = [rx * sp * Math.cos(th), ry * Math.cos(ph), rz * sp * Math.sin(th)];
    if (deform) p = deform(p, u, v);
    return fr.p(p[0], p[1], p[2]);
  }, { wrapU: true, exFn });
}

// Rounded box via superellipsoid.
export function superBox(fr, rx, ry, rz, e = 4, { nu = 20, nv = 14 } = {}) {
  const q = 2 / e;
  return gridSurface(nu, nv, (u, v) => {
    const th = u * Math.PI * 2, ph = v * Math.PI;
    const sp = spow(Math.sin(ph), q), cp = spow(Math.cos(ph), q);
    return fr.p(rx * sp * spow(Math.cos(th), q), ry * cp, rz * sp * spow(Math.sin(th), q));
  }, { wrapU: true });
}

// Flat ribbon (strap/sheet) along a list of points with a width direction per point.
// pts: [[x,y,z]...], wdir: [[..]...] unit, width w, thickness th (0 => single sheet).
export function ribbon(pts, wdirs, w, { nu = 1 } = {}) {
  const n = pts.length - 1;
  return gridSurface(nu, n, (u, v) => {
    const f = v * n;
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    const p = [0, 1, 2].map((j) => pts[i][j] + (pts[i + 1][j] - pts[i][j]) * k);
    const d = [0, 1, 2].map((j) => wdirs[i][j] + (wdirs[i + 1][j] - wdirs[i][j]) * k);
    return madd(p, d, (u - 0.5) * w);
  });
}

// Tube along a polyline of points with radius function r(t).
export function pipe(pts, r, { nu = 8, perSeg = 2, ref = [0, 1, 0] } = {}) {
  const n = pts.length - 1;
  const nv = n * perSeg;
  // parallel-transport frames
  const T = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    T.push(norm(sub(b, a)));
  }
  const A = [];
  let a0 = perp(ref, T[0]);
  if (len(a0) < 1e-6) a0 = perp([1, 0, 0], T[0]);
  A.push(norm(a0));
  for (let i = 1; i <= n; i++) {
    let ai = perp(A[i - 1], T[i]);
    if (len(ai) < 1e-6) ai = A[i - 1];
    A.push(norm(ai));
  }
  return sweep(nu, nv, (v) => {
    const f = v * n;
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    const c = [0, 1, 2].map((j) => pts[i][j] + (pts[i + 1][j] - pts[i][j]) * k);
    const t = norm([0, 1, 2].map((j) => T[i][j] + (T[i + 1][j] - T[i][j]) * k));
    const a = norm(perp([0, 1, 2].map((j) => A[i][j] + (A[i + 1][j] - A[i][j]) * k), t));
    return { c, a, b: cross(t, a) };
  }, (v) => { const rr = r(v); return [rr, rr]; });
}

// Two-bone IK. Returns the middle joint position and the reachable end position.
export function ik2(A, T, l1, l2, pole) {
  let d = sub(T, A);
  let D = len(d);
  const u = D > 1e-9 ? [d[0] / D, d[1] / D, d[2] / D] : [0, -1, 0];
  const Dc = Math.min(Math.max(D, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const ca = (l1 * l1 + Dc * Dc - l2 * l2) / (2 * l1 * Dc);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  let w = perp(pole, u);
  if (len(w) < 1e-9) w = perp([0, 0, 1], u);
  w = norm(w);
  const mid = [A[0] + u[0] * l1 * ca + w[0] * l1 * sa, A[1] + u[1] * l1 * ca + w[1] * l1 * sa, A[2] + u[2] * l1 * ca + w[2] * l1 * sa];
  const end = madd(A, u, Dc);
  return { mid, end, reach: D <= l1 + l2 };
}
export { Frame };
