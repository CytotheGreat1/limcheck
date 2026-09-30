// Seeded randomness and procedural noise.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.seed = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
    this.f = mulberry32(this.seed);
  }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return a + Math.floor((b - a + 1) * this.f()); }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  chance(p) { return this.f() < p; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  gauss(mu = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.f();
    while (v === 0) v = this.f();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // gaussian clipped to +-k sd
  gclip(mu, sd, k = 2) {
    let g = this.gauss(0, 1);
    g = g < -k ? -k : g > k ? k : g;
    return mu + sd * g;
  }
  fork(tag) { return new Rng((this.seed ^ hashStr(String(tag))) >>> 0); }
}

// ---------- Perlin gradient noise (2D + 3D) ----------
const P = new Uint8Array(512);
{
  const r = mulberry32(1791);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function g2(h, x, y) {
  switch (h & 7) {
    case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y;
    case 4: return x; case 5: return -x; case 6: return y; default: return -y;
  }
}
export function noise2(x, y) {
  let X = Math.floor(x), Y = Math.floor(y);
  const xf = x - X, yf = y - Y;
  X &= 255; Y &= 255;
  const u = fade(xf), v = fade(yf);
  const aa = P[P[X] + Y], ab = P[P[X] + Y + 1], ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
  const x1 = g2(aa, xf, yf) + u * (g2(ba, xf - 1, yf) - g2(aa, xf, yf));
  const x2 = g2(ab, xf, yf - 1) + u * (g2(bb, xf - 1, yf - 1) - g2(ab, xf, yf - 1));
  return (x1 + v * (x2 - x1)) * 0.7071;
}
function g3(h, x, y, z) {
  const hh = h & 15;
  const u = hh < 8 ? x : y;
  const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
  return ((hh & 1) === 0 ? u : -u) + ((hh & 2) === 0 ? v : -v);
}
export function noise3(x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const xf = x - X, yf = y - Y, zf = z - Z;
  X &= 255; Y &= 255; Z &= 255;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
  const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  const l = (a, b, t) => a + t * (b - a);
  return l(
    l(l(g3(P[AA], xf, yf, zf), g3(P[BA], xf - 1, yf, zf), u),
      l(g3(P[AB], xf, yf - 1, zf), g3(P[BB], xf - 1, yf - 1, zf), u), v),
    l(l(g3(P[AA + 1], xf, yf, zf - 1), g3(P[BA + 1], xf - 1, yf, zf - 1), u),
      l(g3(P[AB + 1], xf, yf - 1, zf - 1), g3(P[BB + 1], xf - 1, yf - 1, zf - 1), u), v),
    w);
}
export function fbm2(x, y, oct = 5, lac = 2.0, gain = 0.5) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x, y);
    n += a;
    a *= gain;
    x = x * lac + 17.3;
    y = y * lac - 9.1;
  }
  return s / n;
}
export function fbm3(x, y, z, oct = 5, lac = 2.0, gain = 0.5) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x, y, z);
    n += a;
    a *= gain;
    x = x * lac + 17.3; y = y * lac - 9.1; z = z * lac + 3.7;
  }
  return s / n;
}
export function ridge2(x, y, oct = 5) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(noise2(x, y) * 1.4);
    s += a * v * v;
    n += a;
    a *= 0.5;
    x = x * 2.03 + 11.1; y = y * 2.03 - 5.3;
  }
  return s / n;
}

// Cheap hash -> [0,1)
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tileable baked 2D fbm texture for fast per-pixel sampling.
export class NoiseTex {
  constructor(size = 512, period = 8, oct = 5, seedOff = 0) {
    this.n = size;
    this.d = new Float32Array(size * size);
    // tileable perlin by periodic lattice: sample noise on a torus embedded in 4D is costly;
    // instead blend four offset copies (classic seamless trick).
    const s = size;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = x / s, v = y / s;
        const f = (a, b) => fbm2(a * period + seedOff, b * period - seedOff * 0.7, oct);
        const n00 = f(u, v), n10 = f(u - 1, v), n01 = f(u, v - 1), n11 = f(u - 1, v - 1);
        const val = n00 * (1 - u) * (1 - v) + n10 * u * (1 - v) + n01 * (1 - u) * v + n11 * u * v;
        this.d[y * s + x] = val;
      }
    }
    // normalise to roughly [-1,1]
    let mx = 0;
    for (let i = 0; i < this.d.length; i++) mx = Math.max(mx, Math.abs(this.d[i]));
    for (let i = 0; i < this.d.length; i++) this.d[i] /= mx;
  }
  // bilinear, wrap
  at(x, y) {
    const n = this.n, d = this.d;
    x *= n; y *= n;
    let xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    xi = ((xi % n) + n) % n; yi = ((yi % n) + n) % n;
    const x1 = xi + 1 === n ? 0 : xi + 1, y1 = yi + 1 === n ? 0 : yi + 1;
    const a = d[yi * n + xi], b = d[yi * n + x1], c = d[y1 * n + xi], e = d[y1 * n + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
  }
}
