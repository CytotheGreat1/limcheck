// Small vector / frame toolkit. Vectors are plain [x, y, z] arrays.
// World axes: +x screen-right, +y up, +z away from the viewer.

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const neg = (a) => [-a[0], -a[1], -a[2]];

// Rodrigues rotation of v around unit axis k by angle a.
export function rotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const cx = k[1] * v[2] - k[2] * v[1];
  const cy = k[2] * v[0] - k[0] * v[2];
  const cz = k[0] * v[1] - k[1] * v[0];
  return [
    v[0] * c + cx * s + k[0] * kd * (1 - c),
    v[1] * c + cy * s + k[1] * kd * (1 - c),
    v[2] * c + cz * s + k[2] * kd * (1 - c),
  ];
}

// Component of v perpendicular to unit n.
export const perp = (v, n) => madd(v, n, -dot(v, n));

// Orthonormal frame: origin o, x = right, y = up, z = forward (x = y × z).
export class Frame {
  constructor(o, x, y, z) {
    this.o = o; this.x = x; this.y = y; this.z = z;
  }
  static fromYaw(o, yaw) {
    // yaw = 0 faces +z; positive yaw turns toward +x.
    const z = [Math.sin(yaw), 0, Math.cos(yaw)];
    return new Frame(o, [z[2], 0, -z[0]], [0, 1, 0], z);
  }
  // Build from a forward and an approximate up vector.
  static fromFwdUp(o, fwd, up) {
    const z = norm(fwd);
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return new Frame(o, x, y, z);
  }
  static fromUpFwd(o, up, fwd) {
    const y = norm(up);
    const x = norm(cross(y, fwd));
    const z = cross(x, y);
    return new Frame(o, x, y, z);
  }
  p(lx, ly, lz) {
    const o = this.o, x = this.x, y = this.y, z = this.z;
    return [
      o[0] + x[0] * lx + y[0] * ly + z[0] * lz,
      o[1] + x[1] * lx + y[1] * ly + z[1] * lz,
      o[2] + x[2] * lx + y[2] * ly + z[2] * lz,
    ];
  }
  d(lx, ly, lz) {
    const x = this.x, y = this.y, z = this.z;
    return [
      x[0] * lx + y[0] * ly + z[0] * lz,
      x[1] * lx + y[1] * ly + z[1] * lz,
      x[2] * lx + y[2] * ly + z[2] * lz,
    ];
  }
  // World point -> local coordinates.
  local(p) {
    const d = sub(p, this.o);
    return [dot(d, this.x), dot(d, this.y), dot(d, this.z)];
  }
  localDir(d) {
    return [dot(d, this.x), dot(d, this.y), dot(d, this.z)];
  }
  rot(axis, a) {
    return new Frame(this.o, rotAxis(this.x, axis, a), rotAxis(this.y, axis, a), rotAxis(this.z, axis, a));
  }
  // Rotations about the frame's own axes.
  yaw(a) { return this.rot(this.y, a); }
  pitch(a) { return this.rot(this.x, a); } // positive tips forward (z toward -y)
  roll(a) { return this.rot(this.z, a); }
  at(o) { return new Frame(o, this.x, this.y, this.z); }
  moved(lx, ly, lz) { return this.at(this.p(lx, ly, lz)); }
}

// Spherical interpolation of frames (via basis lerp + re-orthonormalisation; fine for moderate angles).
export function blendFrame(a, b, t, o) {
  const z = norm(vlerp(a.z, b.z, t));
  const y0 = vlerp(a.y, b.y, t);
  return Frame.fromFwdUp(o || vlerp(a.o, b.o, t), z, y0);
}

// Quadratic / cubic bezier.
export function bez3(a, b, c, d, t) {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [
    a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3,
    a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3,
    a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3,
  ];
}
export function bez2(a, b, c, t) {
  const u = 1 - t;
  return [
    a[0] * u * u + 2 * b[0] * u * t + c[0] * t * t,
    a[1] * u * u + 2 * b[1] * u * t + c[1] * t * t,
    a[2] * u * u + 2 * b[2] * u * t + c[2] * t * t,
  ];
}

// sRGB hex -> linear rgb triple
export function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [srgbToLin(((n >> 16) & 255) / 255), srgbToLin(((n >> 8) & 255) / 255), srgbToLin((n & 255) / 255)];
}
export function srgbToLin(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linToSrgb(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
export const cmix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const cmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const cmulc = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
